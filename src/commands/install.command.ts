/**
 * @file install.command.ts
 * @description Setup wizard with tool verification, installation guidance, and
 * environment topology configuration. Verifies all required tools are available,
 * sets up Python virtual environments for workers, and configures deployment
 * topology (local dev vs production, bundled vs external).
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import chalk from "chalk";
import {
  intro,
  outro,
  select,
  text,
  note,
  confirm,
  createSpinner,
  logSuccess,
  logWarning,
  logError,
  logStep,
  logInfo,
  handleCancel,
} from "../ui/prompts";
import {
  locateWorkspace,
  resolveEnvFile,
  parseEnvFile,
  mergeEnvFile,
  writeEnvFile,
  ensureDir,
  isAppleSilicon,
  hasTool,
} from "../ui/platform";
import {
  detectAllTools,
  formatToolResult,
  installViaBrew,
  setupMediaWorkerVenv,
  resolveMediaWorkerPython,
  type ToolCheckResult,
} from "../services/tool-installer";
import { ensureDbRolePasswords } from "../utils/platform";
import { bootstrapWorkspace } from "../services/workspace-bootstrap";

function secureHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export const installCommand = new Command("install")
  .description("Setup wizard — verify tools, install dependencies, and configure deployment topology")
  .option("--check-only", "Read-only: verify tool availability & versions, then exit (no .env / compose changes)")
  .option("-y, --yes", "Non-interactive mode — accept every default (clone, tools, local dev topology, bundled infra)")
  .option("--dir <path>", "Where to clone the platform when no workspace is found", "orazaka")
  .option("--depth <n>", "git clone depth for the platform repositories (0 = full history)", "1")
  .action(async (options: { checkOnly?: boolean; yes?: boolean; dir: string; depth: string }) => {
    const startDir = process.cwd();
    // Without a terminal nobody can answer a prompt: take the defaults rather than crash on TTY init,
    // but only --yes installs tools or clones anything.
    const yes = options.yes === true;
    const interactive = !yes && process.stdin.isTTY === true;
    let workspaceRoot = locateWorkspace() ?? process.cwd();
    await intro(chalk.cyan.bold("🥷 Orazaka Setup Wizard"));

    // ─── Phase 1: Tool Verification ─────────────────────────────
    await logStep("Phase 1 — Tool Verification");

    const report = detectAllTools();
    const lines: string[] = [];

    // Group by category
    const categoryLabels: Record<string, string> = {
      infra: "🐳 Infrastructure",
      runtime: "⚙️  Runtime",
      ai: "🤖 AI Engines",
      media: "🎬 Media Processing",
      build: "🔧 Build Tools",
    };

    const grouped = new Map<string, ToolCheckResult[]>();
    for (const r of report.results) {
      const cat = r.tool.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(r);
    }

    for (const [category, results] of grouped) {
      lines.push(`${chalk.bold(categoryLabels[category] ?? category)}`);
      for (const r of results) {
        lines.push(`  ${formatToolResult(r)}`);
      }
      lines.push("");
    }

    await note(lines.join("\n"), "Tool Status Report");

    // Report summary
    if (report.allCriticalMet) {
      await logSuccess("All critical tools are available ✔");
    } else {
      await logError(
        `${String(report.missingCritical.length)} critical tool(s) missing — these must be installed before running Orazaka.`
      );
    }

    if (report.missingOptional.length > 0) {
      await logWarning(
        `${String(report.missingOptional.length)} optional tool(s) missing — some features may be unavailable.`
      );
    }

    // ─── Check-only mode stops here ─────────────────────────────
    // Read-only contract: scan tools and report, but never touch .env,
    // docker-compose, or Python venvs. Use plain `install` to configure.
    if (options.checkOnly) {
      await note(
        [
          `${report.allCriticalMet ? chalk.green("✔") : chalk.red("✖")} Critical tools: ${report.allCriticalMet ? "all present" : `${String(report.missingCritical.length)} missing`}`,
          `${chalk.yellow("ℹ")} Optional missing: ${String(report.missingOptional.length)}`,
          "",
          chalk.gray("Read-only check — no files were modified."),
          `Run ${chalk.cyan("npx orazaka install")} to install tools & configure .env.`,
        ].join("\n"),
        "Check Summary"
      );
      await outro(chalk.cyan("Tool check complete (read-only)."));
      return;
    }

    // ─── Phase 2: Guided Installation ───────────────────────────
    const allMissing = [...report.missingCritical, ...report.missingOptional];

    if (allMissing.length > 0 && process.platform === "darwin" && hasTool("brew")) {
      await logStep("Phase 2 — Install Missing Tools via Homebrew");

      for (const missing of allMissing) {
        if (!missing.tool.brewFormula) continue;

        let shouldInstall = yes;
        if (interactive) {
          const answer = await confirm({
            message: `Install ${chalk.cyan(missing.tool.name)} via ${chalk.gray(`brew install ${missing.tool.brewFormula}`)}?`,
            initialValue: true,
          });
          shouldInstall = answer === true;
        }

        if (shouldInstall) {
          const spinner = await createSpinner();
          spinner.start(`Installing ${missing.tool.name}...`);
          const success = installViaBrew(missing.tool.brewFormula);
          if (success) {
            spinner.stop(`${missing.tool.name} installed successfully.`);
            await logSuccess(`✔ ${missing.tool.name} installed`);
          } else {
            spinner.stop(`${missing.tool.name} installation failed.`, 1);
            await logError(`Failed to install ${missing.tool.name}. Install manually: ${chalk.cyan(missing.installHint)}`);
          }
        }
      }
    } else if (allMissing.length > 0) {
      await logInfo("Install missing tools manually:");
      for (const m of allMissing) {
        console.log(`  ${chalk.yellow("→")} ${m.tool.name}: ${chalk.cyan(m.installHint)}`);
      }
    }

    // ─── Workspace: clone the platform when there is none ───────
    if (!locateWorkspace()) {
      await logStep("Workspace — no Orazaka workspace here");
      const target = path.resolve(options.dir);
      let shouldClone = yes;
      if (interactive) {
        const answer = await confirm({
          message: `Clone the Orazaka platform into ${chalk.cyan(target)}? (git, ~20 repositories)`,
          initialValue: true,
        });
        handleCancel(answer);
        shouldClone = answer === true;
      }
      if (!shouldClone || !hasTool("git")) {
        await logError(
          hasTool("git")
            ? `Nothing to configure without a workspace — re-run with ${chalk.cyan("--yes")} to clone it.`
            : "git is required to clone the platform — install it, then run this command again.",
        );
        process.exit(1);
      }
      const result = bootstrapWorkspace(target, { depth: Number.parseInt(options.depth, 10) || 0 });
      if (!result.ok) {
        await logError(result.error ?? "Could not clone the platform.");
        process.exit(1);
      }
      process.chdir(result.root);
      workspaceRoot = result.root;
      await logSuccess(`Workspace ready in ${chalk.cyan(result.root)}`);
    }

    // ─── Phase 3: Media Worker Python Environment ───────────────
    const mediaReqFile = path.join(workspaceRoot, "orazaka-apps", "workers", "orazaka-worker-media", "requirements.txt");
    if (fs.existsSync(mediaReqFile) && hasTool("python3")) {
      await logStep("Phase 3 — Media Worker Python Environment");

      const venvPath = path.join(workspaceRoot, "orazaka-apps", "workers", "orazaka-worker-media", ".venv");
      const venvExists = fs.existsSync(venvPath);

      if (venvExists) {
        await logSuccess("Media worker venv already exists ✔");
      } else {
        let shouldSetup = yes;
        if (interactive) {
          const answer = await confirm({
            message: "Set up Python virtual environment for the media worker?",
            initialValue: true,
          });
          shouldSetup = answer === true;
        }

        if (shouldSetup) {
          const spinner = await createSpinner();
          spinner.start("Creating Python venv and installing dependencies...");
          const result = setupMediaWorkerVenv(workspaceRoot);
          if (result.success) {
            spinner.stop("Media worker environment ready.");
            await logSuccess("✔ Python venv created with dependencies");
          } else {
            spinner.stop("Venv setup failed.", 1);
            await logWarning(`Could not set up venv: ${result.error}`);
          }
        }
      }
    }

    // ─── Phase 4: Deployment Topology Configuration ─────────────
    await logStep("Phase 4 — Deployment Topology Configuration");

    const targetEnv = !interactive ? "local_dev" : await select({
      message: "Select target environment profile:",
      options: [
        {
          value: "local_dev",
          label: "Local Dev (Apple Silicon ARM64)",
          hint: "Bypasses in-Docker Ollama to leverage macOS Metal acceleration",
        },
        {
          value: "production",
          label: "Production (Linux x86_64)",
          hint: "Hardened, containerized standard setup",
        },
      ],
      initialValue: "local_dev",
    });
    handleCancel(targetEnv);

    const infraMode = !interactive ? "bundled" : await select({
      message: "Select infrastructure topology:",
      options: [
        {
          value: "bundled",
          label: "Bundled (provisioned via Docker)",
          hint: "Postgres, Redis, and RabbitMQ spin up as local containers",
        },
        {
          value: "external",
          label: "External (connecting to enterprise clusters)",
          hint: "Bypasses local middleware container provisioning (BYO-Infra)",
        },
      ],
      initialValue: "bundled",
    });
    handleCancel(infraMode);

    // Collect external endpoints if needed
    const externalEndpoints: {
      dbHost?: string;
      redisHost?: string;
      rabbitmqHost?: string;
      ollamaHost?: string;
    } = {};

    if (infraMode === "external") {
      const dbHost = await text({
        message: "Enter external PostgreSQL hostname/IP:",
        placeholder: "e.g., pg-cluster.corp.internal",
        defaultValue: "external-db-host",
      });
      handleCancel(dbHost);
      externalEndpoints.dbHost = dbHost as string;

      const redisHost = await text({
        message: "Enter external Redis hostname/IP:",
        placeholder: "e.g., redis-cluster.corp.internal",
        defaultValue: "external-redis-host",
      });
      handleCancel(redisHost);
      externalEndpoints.redisHost = redisHost as string;

      const rabbitmqHost = await text({
        message: "Enter external RabbitMQ hostname/IP:",
        placeholder: "e.g., mq-cluster.corp.internal",
        defaultValue: "external-rabbitmq-host",
      });
      handleCancel(rabbitmqHost);
      externalEndpoints.rabbitmqHost = rabbitmqHost as string;

      if (targetEnv !== "local_dev") {
        const ollamaHost = await text({
          message: "Enter external Ollama hostname/IP:",
          placeholder: "e.g., ollama-server.corp.internal",
          defaultValue: "external-ollama-host",
        });
        handleCancel(ollamaHost);
        externalEndpoints.ollamaHost = ollamaHost as string;
      }
    }

    // ─── Generate artifacts ─────────────────────────────────────
    const spinner = await createSpinner();
    spinner.start("Generating deployment artifacts...");

    // Write/update .env
    const envPath = resolveEnvFile();
    if (!fs.existsSync(envPath)) {
      // Use template or generate defaults
      const templatePaths = [
        path.join(workspaceRoot, "exemple.env.txt"),
        path.join(workspaceRoot, ".env.example"),
      ];
      let templateContent = "";
      for (const tp of templatePaths) {
        if (fs.existsSync(tp)) {
          templateContent = fs.readFileSync(tp, "utf-8");
          break;
        }
      }
      if (!templateContent) {
        templateContent = [
          "PORT=8080",
          `SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/orazaka_db`,
          `SPRING_DATASOURCE_USERNAME=orazaka_admin`,
          `SPRING_DATASOURCE_PASSWORD=${secureHex(16)}`,
          `REDIS_URL=redis://localhost:6379`,
          `RABBITMQ_HOST=localhost`,
          `RABBITMQ_PORT=5672`,
          `DEFAULT_PROVIDER=ollama`,
          `SPRING_AI_OLLAMA_BASE_URL=http://localhost:11434`,
          `OLLAMA_BASE_URL=http://localhost:11434`,
          `CRYPTO_KEY=${secureHex(16)}`,
          `CRYPTO_SALT=${secureHex(8)}`,
          `VIDEO_WORKER_PORT=8188`,
          `IMAGE_WORKER_PORT=8085`,
          `LOCALAI_PORT=8085`,
        ].join("\n");
      }
      fs.writeFileSync(envPath, templateContent, "utf-8");
    }

    // Apply topology-specific overrides
    const envUpdates: Record<string, string> = {
      DEFAULT_PROVIDER: "ollama",
    };

    if (targetEnv === "local_dev") {
      // Local dev runs the Router + workers NATIVELY on macOS (not in Docker),
      // so they reach native Ollama on localhost. `host.docker.internal` only
      // resolves from inside a container and would throw UnresolvedAddressException.
      envUpdates["SPRING_AI_OLLAMA_BASE_URL"] = "http://localhost:11434";
      envUpdates["OLLAMA_BASE_URL"] = "http://localhost:11434";
    } else {
      if (infraMode === "external" && externalEndpoints.ollamaHost) {
        envUpdates["SPRING_AI_OLLAMA_BASE_URL"] = `http://${externalEndpoints.ollamaHost}:11434`;
        envUpdates["OLLAMA_BASE_URL"] = `http://${externalEndpoints.ollamaHost}:11434`;
      } else {
        envUpdates["SPRING_AI_OLLAMA_BASE_URL"] = "http://ollama:11434";
        envUpdates["OLLAMA_BASE_URL"] = "http://ollama:11434";
      }
    }

    if (infraMode === "external") {
      const dbH = externalEndpoints.dbHost || "external-db-host";
      const redisH = externalEndpoints.redisHost || "external-redis-host";
      const rabbitmqH = externalEndpoints.rabbitmqHost || "external-rabbitmq-host";
      envUpdates["SPRING_DATASOURCE_URL"] = `jdbc:postgresql://${dbH}:5432/orazaka_db`;
      envUpdates["REDIS_URL"] = `redis://${redisH}:6379`;
      envUpdates["RABBITMQ_HOST"] = rabbitmqH;
    }

    // Detect video worker python
    const mediaPython = resolveMediaWorkerPython(workspaceRoot);
    if (mediaPython) {
      envUpdates["VIDEO_WORKER_PYTHON_PATH"] = mediaPython;
    }

    // Non-destructive: never overwrite values the dev already set in .env.
    // `mergeEnvFile` only appends keys that are *absent*. Keys that already
    // exist are preserved; if a present value differs from the topology-derived
    // default we surface it so the dev can reconcile deliberately.
    // A key the template declares empty (VIDEO_WORKER_PYTHON_PATH=) was never set by anyone: fill it.
    const existingEnv = parseEnvFile(envPath);
    const blanks = Object.fromEntries(Object.entries(envUpdates).filter(([k]) => existingEnv[k] === ""));
    if (Object.keys(blanks).length > 0) writeEnvFile(envPath, blanks);
    const conflicts = Object.entries(envUpdates).filter(
      ([k, v]) => k in existingEnv && existingEnv[k] !== "" && existingEnv[k] !== v,
    );
    const added = [...Object.keys(blanks), ...mergeEnvFile(envPath, envUpdates)];

    // Every context role gets its own strong password (`start` applies them to the roles). Generated, written to
    // .env (owner-only, 0600) and never printed — a value the developer already set is kept.
    const generatedPasswords = ensureDbRolePasswords(envPath, () => secureHex(24));

    // Generate docker-compose.override.yml — infra-only model (AGENTS.md §1).
    // The base compose hosts ONLY stateful infra (PG/pgvector, Redis, RabbitMQ);
    // AI runtimes and apps run natively (configured via .env), so local dev needs
    // no service override. For external infra clusters we scale the bundled
    // services to 0 (their endpoints are written to .env above).
    const overrideLines: string[] = [
      "# ==============================================================================",
      "# ORAZAKA — Docker Compose Override (Dynamic Configuration)",
      "# Generated by: npx orazaka install",
      `# Environment: ${targetEnv === "local_dev" ? "Local Dev (Apple Silicon)" : "Production (Linux)"}`,
      `# Infrastructure: ${infraMode === "bundled" ? "Bundled (Docker)" : "External Clusters"}`,
      "# AI runtimes + apps run natively; this file only adjusts stateful infra.",
      "# ==============================================================================",
    ];

    if (infraMode === "external") {
      // Using external PG/Redis/RabbitMQ clusters: disable the bundled services.
      overrideLines.push(
        "services:",
        "  db-vector:",
        "    scale: 0",
        "",
        "  redis:",
        "    scale: 0",
        "",
        "  rabbitmq:",
        "    scale: 0",
        ""
      );
    } else {
      // Bundled infra: the base compose is already complete — no override needed.
      overrideLines.push("services: {}", "");
    }

    const infraOverridePath = path.join(workspaceRoot, "infra", "docker-compose.override.yml");
    ensureDir(path.dirname(infraOverridePath));
    fs.writeFileSync(infraOverridePath, overrideLines.join("\n"), "utf-8");

    spinner.stop("Deployment artifacts generated ✔");

    // ─── Report .env reconciliation ─────────────────────────────
    if (generatedPasswords.length > 0) {
      await logSuccess(
        `Generated ${String(generatedPasswords.length)} database role password(s) in .env ${chalk.gray("(owner-only, never shown)")}: ${chalk.gray(generatedPasswords.join(", "))}`,
      );
    }
    if (added.length > 0) {
      await logSuccess(`Added ${String(added.length)} missing key(s) to .env: ${chalk.gray(added.join(", "))}`);
    } else {
      await logSuccess("✔ .env already complete — no keys added");
    }
    if (conflicts.length > 0) {
      await logWarning(
        "Kept your existing .env values (not overwritten). These differ from the selected topology:\n" +
        conflicts
          .map(([k, v]) => `  ${chalk.yellow(k)} = ${chalk.gray(existingEnv[k])} ${chalk.dim(`(topology suggests ${v})`)}`)
          .join("\n") +
        `\n  Edit ${chalk.cyan(".env")} manually if you want the suggested values.`
      );
    }

    // ─── Summary ────────────────────────────────────────────────
    const summary = [
      `${chalk.green("✔")} Target: ${chalk.cyan(targetEnv === "local_dev" ? "Local Dev (Apple Silicon)" : "Production (Linux)")}`,
      `${chalk.green("✔")} Infra:  ${chalk.cyan(infraMode === "bundled" ? "Bundled (Docker)" : "External Clusters")}`,
      `${chalk.green("✔")} Generated: docker-compose.override.yml`,
      `${chalk.green("✔")} .env: ${added.length > 0 ? `${String(added.length)} key(s) added` : "unchanged"}${conflicts.length > 0 ? `, ${String(conflicts.length)} existing value(s) kept` : ""}`,
    ];

    if (mediaPython) {
      summary.push(`${chalk.green("✔")} Media Worker Python: ${chalk.gray(mediaPython)}`);
    }

    if (isAppleSilicon()) {
      summary.push(`${chalk.green("✔")} Apple Silicon Metal MPS: enabled`);
    }

    // A fresh clone is not built yet: the reactor and the UI workspace come first (AGENTS.md §1).
    const steps: string[] = [];
    if (path.relative(workspaceRoot, startDir).startsWith("..")) {
      steps.push(chalk.cyan(`cd ${path.relative(startDir, workspaceRoot)}`));
    }
    if (!fs.existsSync(path.join(workspaceRoot, "orazaka-apps", "ui", "node_modules"))) {
      steps.push(
        `${chalk.cyan("./mvnw install")}                — Build every JVM repository (one reactor)`,
        `${chalk.cyan("(cd orazaka-apps/ui && npm install)")} — Link the web, mobile and CLI workspaces`,
      );
    }
    steps.push(
      `${chalk.cyan("npx orazaka start --mode dev")}  — Launch middleware + AI engines`,
      `${chalk.cyan("npx orazaka dev")}               — Spawn Router + Web + Admin + Mobile`,
    );
    summary.push(
      "",
      `${chalk.cyan("Next steps:")}`,
      ...steps.map((step, i) => `  ${chalk.white(`${String(i + 1)}.`)} ${step}`),
    );

    await note(summary.join("\n"), "✨ Setup Complete");
    await outro(chalk.green("Orazaka ready. Happy building! 🚀"));
  });
