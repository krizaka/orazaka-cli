/**
 * @file config.command.ts
 * @description Interactive configuration wizard for managing .env variables.
 * Presents a guided, user-friendly interface for reviewing and updating
 * environment configuration without manual file editing.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import chalk from "chalk";
import {
  intro,
  outro,
  select,
  text,
  note,
  logSuccess,
  logWarning,
  logStep,
  handleCancel,
  isCancel,
} from "../ui/prompts";
import { resolveEnvFile, parseEnvFile, writeEnvFile } from "../ui/platform";

/** Configuration categories for organized editing. */
interface ConfigCategory {
  readonly label: string;
  readonly hint: string;
  readonly keys: ConfigKey[];
}

interface ConfigKey {
  readonly key: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly sensitive?: boolean;
  readonly hint?: string;
}

const CONFIG_CATEGORIES: ConfigCategory[] = [
  {
    label: "🌐 Server & Network",
    hint: "Router port, CORS origins, UI URL",
    keys: [
      { key: "PORT", label: "Router Port", defaultValue: "8080", hint: "HTTP port for the Spring Boot Router" },
      { key: "GATEWAY_CORS_ALLOWED_ORIGINS", label: "CORS Origins", defaultValue: "http://localhost:3000", hint: "Comma-separated allowed origins" },
      { key: "UI_URL", label: "Frontend URL", defaultValue: "http://localhost:3000", hint: "Next.js UI base URL" },
    ],
  },
  {
    label: "🐘 PostgreSQL Database",
    hint: "Connection URL, credentials",
    keys: [
      { key: "SPRING_DATASOURCE_URL", label: "JDBC URL", defaultValue: "jdbc:postgresql://localhost:5432/orazaka_db" },
      { key: "SPRING_DATASOURCE_USERNAME", label: "DB Username", defaultValue: "orazaka_admin" },
      { key: "SPRING_DATASOURCE_PASSWORD", label: "DB Password", defaultValue: "", sensitive: true },
    ],
  },
  {
    label: "🐰 RabbitMQ",
    hint: "AMQP broker host, port, credentials",
    keys: [
      { key: "RABBITMQ_HOST", label: "Host", defaultValue: "localhost" },
      { key: "RABBITMQ_PORT", label: "Port", defaultValue: "5672" },
      { key: "RABBITMQ_USER", label: "Username", defaultValue: "guest" },
      { key: "RABBITMQ_PASS", label: "Password", defaultValue: "guest", sensitive: true },
    ],
  },
  {
    label: "🔴 Redis",
    hint: "Cache connection URL",
    keys: [
      { key: "REDIS_URL", label: "Redis URL", defaultValue: "redis://localhost:6379" },
    ],
  },
  {
    label: "🤖 AI Provider",
    hint: "Ollama settings, default models",
    keys: [
      { key: "DEFAULT_PROVIDER", label: "Default Provider", defaultValue: "ollama", hint: "ollama | openai | anthropic" },
      { key: "OLLAMA_BASE_URL", label: "Ollama Base URL", defaultValue: "http://localhost:11434" },
      { key: "OLLAMA_MODEL", label: "Chat Model", defaultValue: "phi3:mini" },
      { key: "OLLAMA_EMBEDDING_MODEL", label: "Embedding Model", defaultValue: "nomic-embed-text:latest" },
      { key: "ROUTER_PROVIDER", label: "Router Provider", defaultValue: "ollama" },
      { key: "ROUTER_MODEL", label: "Router Model", defaultValue: "phi3:mini" },
      { key: "OLLAMA_NUM_PARALLEL", label: "Parallel Requests", defaultValue: "1" },
      { key: "OLLAMA_KEEP_ALIVE", label: "Keep Alive Duration", defaultValue: "24h" },
    ],
  },
  {
    label: "🎨 Workers",
    hint: "Media, Image, Automation worker ports",
    keys: [
      { key: "VIDEO_WORKER_PORT", label: "Media Worker Port", defaultValue: "8188" },
      { key: "IMAGE_WORKER_PORT", label: "Image Worker Port", defaultValue: "8085" },
    ],
  },
  {
    label: "🔐 Security",
    hint: "Encryption keys and salt",
    keys: [
      { key: "CRYPTO_KEY", label: "Encryption Key", defaultValue: "", sensitive: true, hint: "Auto-generated during init" },
      { key: "CRYPTO_SALT", label: "Encryption Salt", defaultValue: "", sensitive: true, hint: "Auto-generated during init" },
    ],
  },
];

export const configCommand = new Command("config")
  .description("Interactive configuration wizard — review and update .env variables")
  .option("-l, --list", "List all current configuration values")
  .option("-c, --category <name>", "Jump directly to a specific category")
  .action(async (options: { list?: boolean; category?: string }) => {
    const envPath = resolveEnvFile();
    const envExists = fs.existsSync(envPath);

    await intro(chalk.cyan.bold("🥷 Orazaka Configuration Wizard"));

    if (!envExists) {
      await logWarning(
        "No .env file found in the current directory.\n" +
        "  Run " + chalk.cyan("npx orazaka init") + " first to generate a secure environment configuration."
      );
      await outro("Configuration wizard aborted.");
      return;
    }

    const currentEnv = parseEnvFile(envPath);

    // ─── List mode ─────────────────────────────────────────────
    if (options.list) {
      for (const category of CONFIG_CATEGORIES) {
        const lines: string[] = [];
        for (const k of category.keys) {
          const value = currentEnv[k.key] ?? chalk.gray("(not set)");
          const displayValue = k.sensitive && currentEnv[k.key]
            ? chalk.gray("●".repeat(Math.min(value.length, 16)))
            : chalk.white(value);
          lines.push(`${chalk.yellow(k.key.padEnd(35))} ${displayValue}`);
        }
        await note(lines.join("\n"), category.label);
      }
      await outro("Use " + chalk.cyan("npx orazaka config") + " (without --list) to edit values interactively.");
      return;
    }

    // ─── Interactive editing loop ──────────────────────────────
    while (true) {
      const categoryChoice = await select({
        message: "Which configuration category would you like to edit?",
        options: [
          ...CONFIG_CATEGORIES.map((cat, idx) => ({
            value: idx,
            label: cat.label,
            hint: cat.hint,
          })),
          { value: -1, label: "💾 Save & Exit", hint: "Write changes and quit" },
        ],
      });

      handleCancel(categoryChoice);

      if (categoryChoice === -1) {
        break;
      }

      const category = CONFIG_CATEGORIES[categoryChoice as number];
      if (!category) continue;

      await logStep(`Editing: ${category.label}`);

      const updates: Record<string, string> = {};

      for (const k of category.keys) {
        const currentValue = currentEnv[k.key] ?? k.defaultValue;

        const newValue = await text({
          message: `${k.label}${k.hint ? chalk.gray(` (${k.hint})`) : ""}`,
          placeholder: k.defaultValue,
          defaultValue: currentValue,
          validate: (val: string) => {
            if (k.key === "PORT" || k.key === "RABBITMQ_PORT" || k.key === "VIDEO_WORKER_PORT" || k.key === "IMAGE_WORKER_PORT") {
              const num = parseInt(val, 10);
              if (isNaN(num) || num < 1 || num > 65535) {
                return "Port must be a number between 1 and 65535";
              }
            }
            return undefined;
          },
        });

        if (isCancel(newValue)) {
          await logWarning("Skipped remaining fields in this category.");
          break;
        }

        if (newValue !== currentValue) {
          updates[k.key] = newValue;
          currentEnv[k.key] = newValue;
        }
      }

      if (Object.keys(updates).length > 0) {
        writeEnvFile(envPath, updates);
        await logSuccess(`Updated ${String(Object.keys(updates).length)} value(s) in .env`);
      } else {
        await logStep("No changes made in this category.");
      }
    }

    await outro(chalk.green("✨ Configuration saved. Your .env is up to date."));
  });
