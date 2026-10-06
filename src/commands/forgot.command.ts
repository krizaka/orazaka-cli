/**
 * @file forgot.command.ts
 * @description Command to initiate a password reset request.
 */

import { Command } from "commander";
import { intro, outro, text, createSpinner, isCancel } from "../ui/prompts";
import chalk from "chalk";
import { AuthApi } from "../services/auth.api";

async function promptEmail(emailArg?: string): Promise<string> {
  if (emailArg) return emailArg;
  const emailInput = await text({
    message: "Enter your account email:",
    placeholder: "username@orazaka.com",
    validate: (val) => val.includes("@") ? undefined : "Invalid email address",
  });
  if (isCancel(emailInput)) {
    throw new Error("CANCELLED");
  }
  return emailInput;
}

export const forgotCommand = new Command("forgot")
  .description("Request a password reset token via email")
  .argument("[email]", "Account email address")
  .action(async (emailArg?: string) => {
    try {
      await intro(chalk.cyan("Orazaka Password Recovery"));

      const email = await promptEmail(emailArg);
      const s = await createSpinner();
      s.start("Requesting password reset...");

      try {
        const result = await AuthApi.forgotPassword(email);
        s.stop("Request processed");
        await outro(chalk.green(`✓ ${result.message}`));
        await outro(chalk.yellow("Check your email for the reset token, then run: orazaka reset"));
      } catch (err: unknown) {
        s.stop("Request failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        await outro(chalk.red(`❌ Password Reset Request Failed: ${msg}`));
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "CANCELLED") {
        await outro(chalk.red("Password recovery cancelled."));
        return;
      }
      throw err;
    }
  });
