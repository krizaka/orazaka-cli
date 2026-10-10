/**
 * @file demo.command.ts
 * @description `orazaka demo seed` — the demo persona (Eric) on the local stack, replayable.
 *
 * Refuses anything but a local, non-deployed target (services/demo/demo.guard.ts). The password is
 * DEMO_PASSWORD, or the persona's local default; the plan is set by the development administrator
 * (ADMIN_EMAIL / ADMIN_PASSWORD from .env).
 */

import { Command } from "commander";
import chalk from "chalk";
import { intro, logError, logInfo, logSuccess, outro } from "../ui/prompts";
import { ROUTER_URL, strEnv } from "../utils/config";
import { DemoSeeder } from "../services/demo/demo.seed";
import { DEMO_PERSONA } from "../services/demo/demo.persona";

async function seed(opts: { fresh?: boolean }): Promise<void> {
  await intro(chalk.cyan("Orazaka demo persona"));
  const password = strEnv("DEMO_PASSWORD", DEMO_PERSONA.defaultPassword);
  try {
    const result = await new DemoSeeder({
      baseUrl: ROUTER_URL,
      mailUrl: strEnv("MAILPIT_URL", "http://localhost:8025"),
      password,
      admin: { email: strEnv("ADMIN_EMAIL", "admin@orazaka.com"), password: strEnv("ADMIN_PASSWORD", "Admin123!") },
      env: process.env,
      fetch: (url, init) => fetch(url, init),
      onStep: (line) => void logSuccess(`✔ ${line}`),
      fresh: opts.fresh,
    }).run();
    await logInfo(
      `Sign in as ${chalk.bold(result.email)} / ${chalk.bold(password)} — ${result.studios.length} Studios, ` +
        `${result.packs.length} packs, plan ${result.plan}. Conversations: orazaka-web-client \`npm run record:tour -- prepare\`.`,
    );
    await outro(chalk.green(`Good evening, ${DEMO_PERSONA.username}.`));
  } catch (err) {
    await logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export const demoCommand = new Command("demo").description("Demonstration persona on the local stack (never on a deployed one)");

demoCommand
  .command("seed")
  .description("Create or refresh Eric, the demo persona: account, onboarding, plan, packs and Studios (replayable)")
  .option("--fresh", "Delete Eric's conversations first, for a demo that starts from a clean history")
  .action(seed);
