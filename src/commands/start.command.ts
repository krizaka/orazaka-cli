/**
 * @file start.command.ts
 * @description Service startup with dev/full mode, selective service
 * launching, and intelligent recovery strategies.
 *
 * Dev mode:  Starts only Docker middleware + AI engines (you run the Router from your IDE,
 *            or via `orazaka dev` which spawns it for you alongside the web apps).
 * Full mode: Starts everything including the Router (Spring Boot) and Next.js.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";
import chalk from "chalk";
import { format } from "date-fns";
import {
  intro,
  outro,
  logSuccess,
  logWarning,
  logError,
  logStep,
  logInfo,
  createSpinner,
  note,
} from "../ui/prompts";
import {
  resolveWorkspaceRoot,
  resolveComposeFile,
  resolveLogDir,
  resolvePidFile,
  resolveModelsDir,
  resolveDockerComposeCmd,
  hasTool,
  ensureDir,
} from "../ui/platform";
import { isPortInUse, waitForPort } from "../utils/health";
import { spawnDetachedToLog } from "../utils/process";
import { PORTS, OLLAMA_MODEL } from "../utils/config";
import { resolveMediaWorkerPython } from "../services/tool-installer";

// `checkServiceHealth(port)` → service is up; `waitForService(port, retries)` →
// poll until up. Both delegate to the shared health primitives (utils/health),
// which load `.env`-driven timeouts via utils/config.
const checkServiceHealth = isPortInUse;
const waitForService = waitForPort;

/** Services that can be started individually. */
type ServiceName = "postgres" | "redis" | "rabbitmq" | "ollama" | "localai" | "image-gen" | "media-worker" | "router" | "ui";

export const startCommand = new Command("start")
  .description("Start Orazaka infrastructure — dev mode (Docker middleware + AI engines) or full mode (also Router + UI)")
  .option("--mode <mode>", "Startup mode: dev (default, infra + AI engines) or full (also Router + Next.js UI)", "dev")
  .option("--only <service>", "Start only a specific service (postgres, redis, rabbitmq, ollama, localai, image-gen, media-worker)")
  .option("--skip-health", "Skip final health verification")
  .option("--wait-timeout <ms>", "Timeout for service startup (default: 60000ms)", "60000")
  .option("--allow-partial", "Allow partial startup (some services may fail)")
  .option("--verbose", "Show detailed startup logs")
  .option("--logs", "Tail log files after startup")
  .action(async (options: {
    mode?: string;
    only?: string;
    skipHealth?: boolean;
    waitTimeout?: string;
    allowPartial?: boolean;
    verbose?: boolean;
    logs?: boolean;
  }) => {
    const mode = (options.mode ?? "dev") as "dev" | "full";
    const onlyService = options.only as ServiceName | undefined;

    await intro(chalk.cyan.bold(
      mode === "dev"
        ? "🥷 Orazaka Dev Infrastructure"
        : "🥷 Orazaka Full Infrastructure Bootstrap"
    ));

    const workspaceRoot = resolveWorkspaceRoot();
    const pidFile = resolvePidFile();
    const logDir = resolveLogDir();
    ensureDir(logDir);
    ensureDir(path.dirname(pidFile));

    // Verify compose file
    const composeFile = resolveComposeFile();
    if (!fs.existsSync(composeFile)) {
      await logError(
        "docker-compose.yml not found.\n" +
        `  Run ${chalk.cyan("npx orazaka init")} to generate it.`
      );
      process.exit(1);
    }

    const dockerComposeCmd = resolveDockerComposeCmd();
    if (!dockerComposeCmd) {
      await logError(
        "Docker Compose not found.\n" +
        `  Install Docker Desktop: ${chalk.cyan("https://www.docker.com/products/docker-desktop")}`
      );
      process.exit(1);
    }

    const dateStamp = format(new Date(), "yyyyMMdd_HHmmss");
    const startedServices: string[] = [];
    const spinner = await createSpinner();

    // Helper: should we start this service?
    const shouldStart = (service: ServiceName): boolean => {
      if (onlyService) return onlyService === service;
      return true;
    };

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Docker Middleware (Postgres, Redis, RabbitMQ)
    // ═══════════════════════════════════════════════════════════
    if (shouldStart("postgres") || shouldStart("redis") || shouldStart("rabbitmq")) {
      await logStep("Phase 1: Docker Services (Postgres, Redis, RabbitMQ)");

      const servicesToStart: string[] = [];
      if (shouldStart("postgres")) servicesToStart.push("postgres");
      if (shouldStart("redis")) servicesToStart.push("redis");
      if (shouldStart("rabbitmq")) servicesToStart.push("rabbitmq");

      // Check if any compose service names differ (handle both naming conventions)
      const composeContent = fs.readFileSync(composeFile, "utf-8");
      const actualServices: string[] = [];
      for (const svc of servicesToStart) {
        // Check for alternative names in compose file
        if (svc === "postgres") {
          if (composeContent.includes("db-vector:")) actualServices.push("db-vector");
          else if (composeContent.includes("postgres:")) actualServices.push("postgres");
          else actualServices.push(svc);
        } else {
          actualServices.push(svc);
        }
      }
      // The local SMTP sink the notification service delivers e-mail to (inbox on :8025).
      if (composeContent.includes("mailpit:")) actualServices.push("mailpit");

      spinner.start("Launching Docker containers...");
      try {
        execSync(
          `${dockerComposeCmd} -p orazaka -f "${composeFile}" up -d ${actualServices.join(" ")}`,
          { stdio: options.verbose ? "inherit" : "ignore" }
        );
        spinner.stop("Docker containers launched.");
      } catch (err) {
        spinner.stop("Failed to launch Docker containers", 1);
        if (!options.allowPartial) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          await logError(`Docker error: ${msg}`);
          process.exit(1);
        }
        await logWarning("Continuing with partial startup...");
      }

      // Health checks
      spinner.start("Verifying Docker services...");
      const dockerChecks = [
        { port: PORTS.postgres, name: "PostgreSQL", service: "postgres" as ServiceName },
        { port: PORTS.redis, name: "Redis", service: "redis" as ServiceName },
        { port: PORTS.rabbitmq, name: "RabbitMQ", service: "rabbitmq" as ServiceName },
      ];

      for (const check of dockerChecks) {
        if (!shouldStart(check.service)) continue;
        const healthy = await waitForService(check.port, 30);
        if (healthy) {
          await logSuccess(`✔ ${check.name} healthy (port ${String(check.port)})`);
          startedServices.push(check.name);
        } else {
          await logWarning(`⚠ ${check.name} not responding`);
          if (!options.allowPartial) process.exit(1);
        }
      }
      spinner.stop();

      if (shouldStart("db-vector" as ServiceName)) {
        await applyRolePasswords(dockerComposeCmd);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Ollama LLM Engine
    // ═══════════════════════════════════════════════════════════
    if (shouldStart("ollama")) {
      await logStep("Phase 2: AI Engine (Ollama)");

      const ollamaActive = await checkServiceHealth(PORTS.ollama);
      if (ollamaActive) {
        await logSuccess("✔ Ollama already active");
        startedServices.push("Ollama");
      } else {
        await logWarning(`Ollama not active on port ${String(PORTS.ollama)}.`);
        let started = false;

        // Try macOS app first
        if (process.platform === "darwin") {
          try {
            execSync("open -a Ollama", { stdio: "ignore" });
            await logStep("Launched Ollama.app...");
            started = true;
          } catch { /* app not installed */ }
        }

        // Try CLI
        if (!started && hasTool("ollama")) {
          const ollamaProcess = spawnDetachedToLog("ollama", ["serve"], {
            logFile: path.join(logDir, `${dateStamp}_ollama.log`),
            pidFile,
            pidName: "ollama",
          });
          await logStep(`Started ollama serve (PID ${String(ollamaProcess.pid)})`);
          started = true;
        }

        if (started) {
          spinner.start("Waiting for Ollama...");
          const healthy = await waitForService(PORTS.ollama, 60);
          spinner.stop();
          if (healthy) {
            await logSuccess("✔ Ollama online");
            startedServices.push("Ollama");
          } else {
            await logWarning("⚠ Ollama not responding");
            if (!options.allowPartial) process.exit(1);
          }
        } else {
          await logWarning(
            "⚠ Ollama not found.\n" +
            `  Install: ${chalk.gray("https://ollama.ai")} or ${chalk.gray("brew install ollama")}`
          );
        }
      }

      // Pull model if needed
      if (hasTool("ollama") && (await checkServiceHealth(PORTS.ollama))) {
        try {
          const model = OLLAMA_MODEL;
          const modelList = execSync("ollama list").toString();
          if (!modelList.includes(model)) {
            spinner.start(`Pulling model ${model}...`);
            execSync(`ollama pull ${model}`, {
              stdio: options.verbose ? "inherit" : "ignore",
            });
            spinner.stop(`Model ${model} ready.`);
          } else {
            await logSuccess(`✔ Model ${model} available`);
          }
        } catch {
          await logWarning("Could not verify Ollama models.");
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: LocalAI Image Worker (macOS M1/M2/M3)
    // ═══════════════════════════════════════════════════════════
    if (shouldStart("localai")) {
      await logStep("Phase 3: Image Generation (LocalAI)");

      const imageWorkerPort = PORTS.localai;
      const imageWorkerActive = await checkServiceHealth(imageWorkerPort);

      if (imageWorkerActive) {
        await logSuccess(`✔ Image Worker already active on port ${String(imageWorkerPort)}`);
        startedServices.push("LocalAI");
      } else if (process.platform === "darwin" && hasTool("local-ai")) {
        const modelsPath = resolveModelsDir();

        spinner.start("Launching LocalAI (Metal GPU on Apple Silicon)...");
        try {
          // LocalAI v3+/v4: the API server is started via the `run` subcommand
          // with `--address` (the old top-level `--listen` flag no longer exists).
          const localAiProcess = spawnDetachedToLog("local-ai", [
            "run",
            `--address=127.0.0.1:${String(imageWorkerPort)}`,
            `--models-path=${modelsPath}`,
          ], {
            logFile: path.join(logDir, `${dateStamp}_image-worker.log`),
            env: { ...process.env, FORCE_CPU: "false" },
            pidFile,
            pidName: "image-worker",
          });
          spinner.stop(`LocalAI started (PID ${String(localAiProcess.pid)})`);

          const healthy = await waitForService(imageWorkerPort, 45);
          if (healthy) {
            await logSuccess(`✔ Image Worker ready on port ${String(imageWorkerPort)}`);
            startedServices.push("LocalAI");
          } else {
            await logWarning("⚠ Image Worker not responding (image generation may fail)");
          }
        } catch (e) {
          spinner.stop("Failed to start LocalAI", 1);
          const msg = e instanceof Error ? e.message : String(e);
          await logWarning(`⚠ LocalAI startup failed: ${msg}`);
        }
      } else {
        await logWarning(
          "⚠ LocalAI not available (image generation disabled)\n" +
          `  On macOS: ${chalk.gray("brew install localai")}\n` +
          `  Or: ${chalk.gray("https://localai.io/docs/getting-started/")}`
        );
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3b: Image Generation Server (stable-diffusion.cpp — Metal, :8086)
    // LocalAI (:8085) serves audio only; real image generation is the dedicated
    // sd-server on :8086 (ai_providers.localai-image base-url). Without it, image
    // jobs hit "connection refused" → SafeImageModel transparent-PNG fallback.
    // ═══════════════════════════════════════════════════════════
    if (shouldStart("image-gen")) {
      await logStep("Phase 3b: Image Generation (Stable Diffusion)");

      const imageGenPort = PORTS.imageGen;
      const imageGenActive = await checkServiceHealth(imageGenPort);

      if (imageGenActive) {
        await logSuccess(`✔ Image Gen Worker already active on port ${String(imageGenPort)}`);
        startedServices.push("Image Gen");
      } else {
        const modelsDir = resolveModelsDir();
        const sdModel = path.join(modelsDir, "v1-5-pruned-emaonly.safetensors");
        const sdServerBin = path.join(modelsDir, "stable-diffusion.cpp", "build", "bin", "sd-server");

        if (fs.existsSync(sdModel) && fs.existsSync(sdServerBin)) {
          spinner.start("Starting Image Gen Worker (stable-diffusion.cpp, Metal)...");
          try {
            const sdProcess = spawnDetachedToLog(sdServerBin, [
              "--listen-port", String(imageGenPort),
              "-m", sdModel,
              "--seed", process.env.IMAGE_GEN_SEED ?? "-1",
              // Stated, not left to sd-server's default: the billing meter reports this same
              // count as what a generation consumed, and reads it from the same env var
              // (orazaka.core.image.generation.steps). Change one and you must change both —
              // ADR-047 records that coupling as this capability's weakest link.
              "--steps", process.env.IMAGE_GEN_STEPS ?? "20",
            ], {
              logFile: path.join(logDir, `${dateStamp}_image-generation-worker.log`),
              env: { ...process.env },
              pidFile,
              pidName: "image-gen-worker",
            });
            spinner.stop(`Image Gen Worker started (PID ${String(sdProcess.pid)})`);

            const healthy = await waitForService(imageGenPort, 45);
            if (healthy) {
              await logSuccess(`✔ Image Gen Worker ready on port ${String(imageGenPort)}`);
              startedServices.push("Image Gen");
            } else {
              await logWarning("⚠ Image Gen Worker not responding (image generation may fail)");
            }
          } catch (e) {
            spinner.stop("Failed to start Image Gen Worker", 1);
            const msg = e instanceof Error ? e.message : String(e);
            await logWarning(`⚠ Image Gen Worker startup failed: ${msg}`);
          }
        } else {
          const issues: string[] = [];
          if (!fs.existsSync(sdModel)) issues.push(`SD model not found: ${sdModel}`);
          if (!fs.existsSync(sdServerBin)) issues.push(`sd-server binary not found: ${sdServerBin}`);
          await logWarning(
            `⚠ Image Gen Worker not available (${issues.join("; ")})\n` +
            `  Setup: ${chalk.gray("npx orazaka install")} to build stable-diffusion.cpp + pull the SD model`
          );
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Media Worker (Python — orazaka-worker-media, MLX/Metal)
    // ═══════════════════════════════════════════════════════════
    if (shouldStart("media-worker")) {
      await logStep("Phase 4: Media Generation Worker");

      const mediaWorkerPort = PORTS.mediaWorker;
      const mediaWorkerActive = await checkServiceHealth(mediaWorkerPort);

      if (mediaWorkerActive) {
        await logSuccess(`✔ Media Worker already active on port ${String(mediaWorkerPort)}`);
        startedServices.push("Media Worker");
      } else {
        // Native Python media worker: orazaka-apps/workers/orazaka-worker-media
        const mediaWorkerDir = path.join(workspaceRoot, "orazaka-apps", "workers", "orazaka-worker-media");
        const mainPy = path.join(mediaWorkerDir, "app", "main.py");
        const pythonCmd = resolveMediaWorkerPython(workspaceRoot);

        if (fs.existsSync(mainPy) && pythonCmd) {
          spinner.start("Starting Media Worker (Python)...");
          try {
            // app.consumer consumes orazaka.jobs.video AND serves the :8188 HTTP
            // pipeline in-process (Phase 3b); the port comes from MEDIA_WORKER_PORT.
            const mediaProcess = spawnDetachedToLog(pythonCmd, ["-u", "-m", "app.consumer"], {
              logFile: path.join(logDir, `${dateStamp}_media-worker.log`),
              env: {
                ...process.env,
                PYTHONPATH: mediaWorkerDir,
              },
              pidFile,
              pidName: "media-worker",
            });
            spinner.stop(`Media Worker started (PID ${String(mediaProcess.pid)})`);

            const healthy = await waitForService(mediaWorkerPort, 30);
            if (healthy) {
              await logSuccess(`✔ Media Worker ready on port ${String(mediaWorkerPort)}`);
              startedServices.push("Media Worker");
            } else {
              await logWarning("⚠ Media Worker not responding");
            }
          } catch (e) {
            spinner.stop("Failed to start Media Worker", 1);
            const msg = e instanceof Error ? e.message : String(e);
            await logWarning(`⚠ Media Worker startup failed: ${msg}`);
          }
        } else {
          const issues: string[] = [];
          if (!fs.existsSync(mainPy)) issues.push("main.py not found at expected path");
          if (!pythonCmd) issues.push("Python 3 not found");
          await logWarning(
            `⚠ Media Worker not available (${issues.join(", ")})\n` +
            `  Setup: ${chalk.gray("npx orazaka install")} to configure the media worker environment`
          );
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: Router + UI (full mode only)
    // ═══════════════════════════════════════════════════════════
    if (mode === "full" && !onlyService) {
      // Router (Spring Boot ingress app — RouterApplication)
      if (shouldStart("router")) {
        await logStep("Phase 5a: Starting Router (Spring Boot)...");
        const routerTargetDir = path.join(workspaceRoot, "orazaka-apps", "services", "orazaka-conversation-service", "target");
        const routerJarName = fs.existsSync(routerTargetDir)
          ? fs.readdirSync(routerTargetDir)
              .find((f: string) => f.endsWith(".jar") && !f.endsWith("-sources.jar"))
          : undefined;
        const routerJar = path.join(routerTargetDir, routerJarName ?? "orazaka-conversation-service.jar");

        if (fs.existsSync(routerJar)) {
          spawnDetachedToLog("java", ["-jar", routerJar], {
            logFile: path.join(logDir, `${dateStamp}_router.log`),
            pidFile,
            pidName: "router",
          });

          const healthy = await waitForService(PORTS.router, 60);
          if (healthy) {
            await logSuccess(`✔ Router ready on port ${String(PORTS.router)}`);
            startedServices.push("Router");
          } else {
            await logWarning("⚠ Router did not start in time");
          }
        } else {
          await logWarning(
            "⚠ Router JAR not found. Build first:\n" +
            `  ${chalk.gray("./mvnw clean package -pl orazaka-apps/services/orazaka-conversation-service -am -DskipTests")}`
          );
        }
      }

      // UI
      if (shouldStart("ui")) {
        await logStep("Phase 5b: Starting Next.js UI...");
        const uiDir = path.join(workspaceRoot, "orazaka-apps", "ui");
        if (fs.existsSync(uiDir)) {
          const uiProcess = spawnDetachedToLog("npm", ["run", "dev"], {
            cwd: uiDir,
            logFile: path.join(logDir, `${dateStamp}_ui.log`),
            pidFile,
            pidName: "ui",
          });
          await logSuccess(`✔ UI started on port ${String(PORTS.web)} (PID ${String(uiProcess.pid)})`);
          startedServices.push("Next.js UI");
        } else {
          await logWarning("⚠ UI directory not found");
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════
    const summaryLines = [
      `${chalk.green("✔")} Services: ${startedServices.length > 0 ? startedServices.join(", ") : chalk.yellow("none")}`,
      `${chalk.yellow("📍")} Logs: ${chalk.cyan(path.relative(workspaceRoot, logDir))}`,
      `${chalk.yellow("📋")} PIDs: ${chalk.cyan(path.relative(workspaceRoot, pidFile))}`,
    ];

    if (mode === "dev") {
      summaryLines.push(
        "",
        `${chalk.cyan.bold("Dev mode — infra + AI engines are up. Now run the apps:")}`,
        `  ${chalk.white("→")} ${chalk.cyan("All apps at once")}: ${chalk.gray("npx orazaka dev")} ${chalk.dim("(spawns Router + Web + Admin + Mobile)")}`,
        `  ${chalk.white("→")} ${chalk.cyan("Router in IDE")}: Run/Debug ${chalk.yellow("RouterApplication")} in IntelliJ, then ${chalk.gray("npx orazaka dev --skip-router")}`,
        "",
        `${chalk.gray("Tip:")} Use ${chalk.cyan("npx orazaka logs")} to tail all service logs`,
        `${chalk.gray("Tip:")} Use ${chalk.cyan("npx orazaka status")} to check service health`,
      );
    }

    await note(summaryLines.join("\n"), mode === "dev" ? "🛠  Dev Infrastructure Ready" : "🚀 Full Infrastructure Ready");

    // Tail logs if requested
    if (options.logs) {
      await logInfo("Tailing logs (Ctrl+C to stop)...\n");
      try {
        const logFiles = fs.readdirSync(logDir)
          .filter((f: string) => f.startsWith(dateStamp))
          .map((f: string) => path.join(logDir, f));

        if (logFiles.length > 0) {
          const tail = spawn("tail", ["-f", ...logFiles], {
            stdio: "inherit",
          });
          await new Promise<void>((resolve) => {
            tail.on("exit", () => resolve());
          });
        }
      } catch { /* ignore */ }
    }

    await outro(chalk.cyan(mode === "dev"
      ? "Dev infrastructure ready! Run `npx orazaka dev` (or start RouterApplication in IntelliJ) 🚀"
      : `Full infrastructure ready! Open http://localhost:${String(PORTS.web)} 🚀`
    ));
  });

/** The bounded contexts whose database role owns its own schema (AGENTS.md §5). */
const DB_ROLE_CONTEXTS = ["IDENTITY", "KNOWLEDGE", "AUTOMATION", "BILLING", "STUDIO"] as const;

/**
 * Sets each context role's password from the environment.
 *
 * `infra/initdb/*.sql` creates the roles with `LOGIN` and no password, because psql 15 cannot read
 * the environment (`\getenv` arrived in 16) and ERR-125 bans a shell script in the initdb
 * directory. A committed literal was the third option and is the defect being closed (audit #5).
 *
 * A role with no password cannot authenticate, so skipping this step leaves the stack unable to
 * connect rather than reachable with a guessable credential — it fails closed. `ALTER ROLE` is
 * idempotent, so re-running `orazaka start` on an existing volume simply re-applies the value.
 */
async function applyRolePasswords(dockerComposeCmd: string): Promise<void> {
  const missing = DB_ROLE_CONTEXTS.filter((ctx) => !process.env[`${ctx}_DB_PASSWORD`]);
  if (missing.length > 0) {
    await logWarning(
      `⚠ No password set for: ${missing.join(", ")} — those roles cannot connect. ` +
        "Set <CTX>_DB_PASSWORD in .env (see exemple.env.txt).",
    );
  }

  // Postgres accepts connections *before* /docker-entrypoint-initdb.d has finished, so the roles
  // may not exist yet when the port opens. Waiting on the port is not waiting on the schema.
  const superuser = process.env.DB_USERNAME ?? "orazaka_app";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let ready: boolean;
    try {
      ready =
        execSync(
          `${dockerComposeCmd} -p orazaka exec -T db-vector psql -U ${superuser} -d postgres ` +
            `-tAc "SELECT 1 FROM pg_roles WHERE rolname = 'krizaka_users';"`,
          { stdio: "pipe", env: process.env },
        )
          .toString()
          .trim() === "1";
    } catch {
      ready = false;
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  let applied = 0;
  for (const ctx of DB_ROLE_CONTEXTS) {
    const password = process.env[`${ctx}_DB_PASSWORD`];
    if (!password) continue;
    const role = `orazaka_${ctx.toLowerCase()}`;
    try {
      // Over stdin, not `-c`: psql only interpolates `:'pw'` for file/stdin input, so `-c` sends
      // the literal `:'pw'` to the server and fails with a syntax error. Interpolating means psql
      // does the quoting, so a password containing a quote cannot terminate the statement — and
      // the value never appears in argv, where `ps` would show it.
      execSync(
        `${dockerComposeCmd} -p orazaka exec -T db-vector ` +
          `psql -U ${superuser} -d postgres ` +
          `-v ON_ERROR_STOP=1 -v pw=${JSON.stringify(password)}`,
        { input: `ALTER ROLE ${role} PASSWORD :'pw';\n`, stdio: ["pipe", "pipe", "pipe"], env: process.env },
      );
      applied += 1;
    } catch {
      await logWarning(`⚠ Could not set the password for ${role}; it cannot connect until it is.`);
    }
  }
  if (applied === DB_ROLE_CONTEXTS.length) {
    await logSuccess("✔ Database role passwords applied from the environment");
  } else {
    // Never claim success on a partial run: a role left without a password cannot connect, and a
    // green line here would send the reader looking for the fault anywhere but at this step.
    await logWarning(`⚠ ${String(applied)}/${String(DB_ROLE_CONTEXTS.length)} role passwords applied`);
  }
}
