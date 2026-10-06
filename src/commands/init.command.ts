/**
 * @file init.command.ts
 * @description Workspace initialization with smart detection.
 * Detects whether the user is inside an existing Orazaka workspace and
 * adapts behavior accordingly: existing workspace = validate + fix,
 * new directory = full scaffold.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import chalk from "chalk";
import {
  intro,
  outro,
  confirm,
  text,
  note,
  logSuccess,
  logWarning,
  logStep,
  logInfo,
  createSpinner,
  handleCancel,
} from "../ui/prompts";
import {
  mergeEnvFile,
  hasTool,
  ensureDir,
  getSystemInfo,
  detectOrazakaWorkspace,
  getToolVersion,
} from "../ui/platform";
import { detectAllTools, formatToolResult } from "../services/tool-installer";

function secureHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function getWorkspaceDirs(root: string): string[] {
  return [
    path.join(root, "var", "orazaka-uploads"),
    path.join(root, "var", "temp"),
    path.join(root, "var", "logs"),
    path.join(root, "infra", "local-db"),
  ];
}

/** All required env keys with sensible defaults. */
function getRequiredEnvDefaults(): Record<string, string> {
  return {
    // Server
    PORT: "8080",
    ROUTER_URL: "http://localhost:8080",
    GATEWAY_CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    UI_URL: "http://localhost:3000",
    // App + middleware host ports (single source of truth for the CLI)
    WEB_PORT: "3000",
    ADMIN_PORT: "3001",
    MOBILE_PORT: "8081",
    OLLAMA_PORT: "11434",
    POSTGRES_PORT: "5432",
    REDIS_PORT: "6379",
    RABBITMQ_MGMT_PORT: "15672",
    // CLI health/probe timing
    CLI_HEALTH_RETRIES: "30",
    CLI_HEALTH_INTERVAL_MS: "1000",
    CLI_HTTP_TIMEOUT_MS: "3000",
    CLI_PORT_PROBE_MS: "300",
    // Database
    POSTGRES_DB: "orazaka_db",
    SPRING_DATASOURCE_URL: "jdbc:postgresql://localhost:5432/orazaka_db",
    SPRING_DATASOURCE_USERNAME: "orazaka_admin",
    SPRING_DATASOURCE_PASSWORD: secureHex(16),
    // Redis
    REDIS_URL: "redis://localhost:6379",
    // RabbitMQ
    RABBITMQ_HOST: "localhost",
    RABBITMQ_PORT: "5672",
    // AI
    DEFAULT_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://localhost:11434",
    SPRING_AI_OLLAMA_BASE_URL: "http://localhost:11434",
    OLLAMA_MODEL: "phi3:mini",
    OLLAMA_EMBEDDING_MODEL: "nomic-embed-text:latest",
    ROUTER_PROVIDER: "ollama",
    ROUTER_MODEL: "phi3:mini",
    OLLAMA_NUM_PARALLEL: "1",
    OLLAMA_KEEP_ALIVE: "24h",
    // Workers
    VIDEO_WORKER_PORT: "8188",
    IMAGE_WORKER_PORT: "8085",
    LOCALAI_PORT: "8085",
    LOCALAI_MODELS_PATH: path.join(process.env.HOME ?? "~", "models", "stable-diffusion"),
    VIDEO_WORKER_PYTHON_PATH: "python3",
    UPLOAD_DIR: "var/orazaka-uploads",
    // Security
    CRYPTO_KEY: secureHex(16),
    CRYPTO_SALT: secureHex(8),
    JWT_SECRET: secureHex(32),
    JWT_EXPIRATION_MS: "86400000",
    // Logs
    LOG_DIR: "var/logs",
    ROUTER_LOG: "var/logs/router.log",
    VIDEO_WORKER_LOG: "var/logs/video-worker.log",
    IMAGE_WORKER_LOG: "var/logs/image-worker.log",
    // Application
    APP_NAME: "Orazaka",
    APP_VERSION: "1.0.0",
    NODE_ENV: "development",
  };
}

function getDefaultComposeYml(): string {
  return `version: '3.8'
services:
  db-vector:
    image: ankane/pgvector:latest
    container_name: orazaka-db-vector
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-orazaka_db}
      POSTGRES_USER: \${SPRING_DATASOURCE_USERNAME:-postgres}
      POSTGRES_PASSWORD: \${SPRING_DATASOURCE_PASSWORD:?SPRING_DATASOURCE_PASSWORD must be set}
    command: postgres -c shared_buffers=256MB -c max_connections=100
    ports:
      - "5432:5432"
    volumes:
      - pgvector_data:/var/lib/postgresql/data
      - ./infra/local-db:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${SPRING_DATASOURCE_USERNAME:-postgres}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - orazaka-network

  redis:
    image: redis:7-alpine
    container_name: orazaka-redis
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - orazaka-network

  rabbitmq:
    image: rabbitmq:3.14-management-alpine
    container_name: orazaka-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: \${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: \${RABBITMQ_PASS:-guest}
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - orazaka-network

networks:
  orazaka-network:
    driver: bridge

volumes:
  pgvector_data:
  redis_data:
  rabbitmq_data:
`;
}

export const initCommand = new Command("init")
  .description("Initialize workspace — detects existing projects, validates config, and fixes gaps")
  .option("-f, --force", "Overwrite existing configuration")
  .option("-y, --yes", "Non-interactive mode with defaults")
  .option("--skip-validation", "Skip diagnostic checks")
  .option("--dir <path>", "Target directory (default: current directory)")
  .action(async (options: {
    force?: boolean;
    yes?: boolean;
    skipValidation?: boolean;
    dir?: string;
  }) => {
    await intro(chalk.cyan.bold("🥷 Orazaka Workspace Initialization"));

    // ─── Resolve target directory ─────────────────────────────
    let targetDir = options.dir
      ? path.resolve(options.dir)
      : process.cwd();

    // ─── Smart workspace detection ────────────────────────────
    const detection = detectOrazakaWorkspace(targetDir);

    // ─── System info ──────────────────────────────────────────
    const sys = getSystemInfo();
    const sysLines = [
      `${chalk.yellow("Platform")}     ${sys.platform} / ${sys.arch}`,
      `${chalk.yellow("CPU")}          ${sys.cpuModel}`,
      `${chalk.yellow("Memory")}       ${String(sys.totalMemoryGb)} GB`,
      `${chalk.yellow("Node")}         ${sys.nodeVersion}`,
      `${chalk.yellow("Workspace")}    ${targetDir}`,
    ];

    if (sys.isAppleSilicon) {
      sysLines.push(`${chalk.yellow("Accelerator")}  ${chalk.green("✔ Apple Silicon Metal MPS")}`);
    }

    // Show tool versions
    const toolVersions: string[] = [];
    if (hasTool("java")) toolVersions.push(`Java ${getToolVersion("java").split("\n")[0]}`);
    if (hasTool("node")) toolVersions.push(`Node ${getToolVersion("node")}`);
    if (hasTool("python3")) toolVersions.push(`Python ${getToolVersion("python3")}`);
    if (hasTool("ollama")) toolVersions.push(`Ollama ${getToolVersion("ollama")}`);
    if (toolVersions.length > 0) {
      sysLines.push(`${chalk.yellow("Tools")}        ${toolVersions.join(", ")}`);
    }

    await note(sysLines.join("\n"), "System Information");

    // ─── Existing workspace flow ──────────────────────────────
    if (detection.isWorkspace) {
      await logSuccess(`Existing Orazaka workspace detected in ${chalk.cyan(targetDir)}`);
      await logStep(`Found markers: ${detection.markers.join(", ")}`);

      if (detection.missing.length > 0) {
        await logWarning(`Missing markers: ${chalk.yellow(detection.missing.join(", "))}`);
      }

      // Validate and fix .env
      const envFile = path.join(targetDir, ".env");
      if (fs.existsSync(envFile)) {
        await logStep("Checking .env completeness...");

        const defaults = getRequiredEnvDefaults();
        const added = mergeEnvFile(envFile, defaults);

        if (added.length > 0) {
          await logSuccess(`Added ${String(added.length)} missing key(s) to .env: ${chalk.gray(added.join(", "))}`);
        } else {
          await logSuccess("✔ .env is complete — no missing keys");
        }
      } else {
        // No .env exists — generate from template or defaults
        await logWarning(".env not found — generating with secure defaults");
        const templatePaths = [
          path.join(targetDir, "exemple.env.txt"),
          path.join(targetDir, ".env.example"),
          path.join(targetDir, ".env.template"),
        ];

        let templateContent = "";
        for (const tp of templatePaths) {
          if (fs.existsSync(tp)) {
            templateContent = fs.readFileSync(tp, "utf-8");
            await logStep(`Using template: ${path.basename(tp)}`);
            break;
          }
        }

        if (templateContent) {
          // Inject secure random values into template
          templateContent = templateContent
            .replace(/SPRING_DATASOURCE_PASSWORD=.*/g, `SPRING_DATASOURCE_PASSWORD=${secureHex(16)}`)
            .replace(/CRYPTO_KEY=.*/g, `CRYPTO_KEY=${secureHex(16)}`)
            .replace(/CRYPTO_SALT=.*/g, `CRYPTO_SALT=${secureHex(8)}`);

          fs.writeFileSync(envFile, templateContent, "utf-8");
        } else {
          // Write defaults
          const defaults = getRequiredEnvDefaults();
          const lines: string[] = [
            "# ──────────────────────────────────────────────────────",
            "# ORAZAKA ENVIRONMENT CONFIGURATION",
            "# Generated by: npx orazaka init",
            `# Timestamp: ${new Date().toISOString()}`,
            "# ──────────────────────────────────────────────────────",
            "",
          ];
          for (const [key, value] of Object.entries(defaults)) {
            lines.push(`${key}=${value}`);
          }
          fs.writeFileSync(envFile, lines.join("\n"), "utf-8");
        }

        // Merge any remaining missing keys
        mergeEnvFile(envFile, getRequiredEnvDefaults());
        await logSuccess("✔ .env generated with secure defaults");
      }

      // Ensure workspace directories exist
      const dirs = getWorkspaceDirs(targetDir);
      let dirsCreated = 0;
      for (const d of dirs) {
        if (!fs.existsSync(d)) {
          ensureDir(d);
          dirsCreated++;
        }
      }
      if (dirsCreated > 0) {
        await logSuccess(`Created ${String(dirsCreated)} missing workspace director(ies)`);
      }

      // Quick tool check
      const toolReport = detectAllTools();
      if (!toolReport.allCriticalMet) {
        await logWarning("Some critical tools are missing:");
        for (const r of toolReport.missingCritical) {
          console.log(`  ${formatToolResult(r)}`);
        }
        console.log(`\n  Run ${chalk.cyan("npx orazaka install")} to install missing tools.`);
      }

      if (toolReport.missingOptional.length > 0) {
        await logInfo("Optional tools not found:");
        for (const r of toolReport.missingOptional) {
          console.log(`  ${formatToolResult(r)}`);
        }
      }

      // Summary
      await note(
        [
          `${chalk.green("✔")} Workspace validated`,
          `${chalk.green("✔")} Environment configuration (.env)`,
          `${chalk.green("✔")} Workspace directories`,
          "",
          `${chalk.cyan("Next steps:")}`,
          `  ${chalk.white("1.")} ${chalk.cyan("npx orazaka install")}     — Install/verify tools`,
          `  ${chalk.white("2.")} ${chalk.cyan("npx orazaka doctor")}      — Full diagnostics`,
          `  ${chalk.white("3.")} ${chalk.cyan("npx orazaka start --mode dev")} — Launch middleware + AI engines`,
          `  ${chalk.white("4.")} ${chalk.cyan("npx orazaka dev")}            — Spawn Router + Web + Admin + Mobile`,
          `  ${chalk.white("5.")} ${chalk.gray("(or debug RouterApplication in IntelliJ + ")}${chalk.cyan("npx orazaka dev --skip-router")}${chalk.gray(")")}`,
        ].join("\n"),
        "✨ Workspace Ready"
      );

      await outro(chalk.green("Happy building! 🚀"));
      return;
    }

    // ─── New workspace flow ───────────────────────────────────
    await logInfo("No Orazaka workspace detected in current directory.");

    if (!options.yes) {
      const initHere = await confirm({
        message: `Initialize Orazaka workspace in ${chalk.cyan(targetDir)}?`,
        initialValue: true,
      });
      handleCancel(initHere);

      if (!initHere) {
        const customDir = await text({
          message: "Enter the directory path for the workspace:",
          placeholder: path.join(process.cwd(), "orazaka"),
          defaultValue: path.join(process.cwd(), "orazaka"),
        });
        handleCancel(customDir);
        targetDir = path.resolve(customDir as string);
      }
    }

    // Create directories
    const spinner = await createSpinner();
    spinner.start("Creating workspace directories...");

    ensureDir(targetDir);
    const dirs = getWorkspaceDirs(targetDir);
    for (const d of dirs) {
      ensureDir(d);
    }

    spinner.stop("Directories created.");

    // Generate .env
    const envFile = path.join(targetDir, ".env");
    const envExists = fs.existsSync(envFile);

    if (envExists && !options.force) {
      await logWarning(
        ".env already exists. Use " + chalk.cyan("--force") + " to regenerate.\n" +
        "  Merging missing keys only..."
      );
      const added = mergeEnvFile(envFile, getRequiredEnvDefaults());
      if (added.length > 0) {
        await logSuccess(`Added ${String(added.length)} missing key(s)`);
      }
    } else {
      const defaults = getRequiredEnvDefaults();
      const lines: string[] = [
        "# ──────────────────────────────────────────────────────",
        "# ORAZAKA ENVIRONMENT CONFIGURATION",
        "# Generated by: npx orazaka init",
        `# Timestamp: ${new Date().toISOString()}`,
        "# ──────────────────────────────────────────────────────",
        "",
      ];
      for (const [key, value] of Object.entries(defaults)) {
        lines.push(`${key}=${value}`);
      }
      fs.writeFileSync(envFile, lines.join("\n"), "utf-8");
      await logSuccess("Secure .env generated with cryptographic secrets.");
    }

    // Generate docker-compose.yml
    const composeFile = path.join(targetDir, "infra", "docker-compose.yml");
    if (!fs.existsSync(composeFile) || options.force) {
      ensureDir(path.dirname(composeFile));
      fs.writeFileSync(composeFile, getDefaultComposeYml(), "utf-8");
      await logSuccess("docker-compose.yml generated.");
    } else {
      await logStep("docker-compose.yml already exists.");
    }

    // Summary
    await note(
      [
        `${chalk.green("✔")} Workspace: ${chalk.cyan(targetDir)}`,
        `${chalk.green("✔")} Environment: .env`,
        `${chalk.green("✔")} Docker Compose: infra/docker-compose.yml`,
        "",
        `${chalk.cyan("Next steps:")}`,
        `  ${chalk.white("1.")} ${chalk.cyan("npx orazaka install")}   — Install required tools`,
        `  ${chalk.white("2.")} ${chalk.cyan("npx orazaka doctor")}    — Run diagnostics`,
        `  ${chalk.white("3.")} ${chalk.cyan("npx orazaka start")}     — Launch infrastructure`,
      ].join("\n"),
      "✨ Initialization Complete"
    );

    await outro(chalk.green("Workspace ready. Happy building! 🚀"));
  });
