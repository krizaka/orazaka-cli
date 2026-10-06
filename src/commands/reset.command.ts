/**
 * @file reset.command.ts
 * @description Command to execute a password reset using a valid token.
 */

import { Command } from "commander";
import { intro, outro, text, password, createSpinner, isCancel } from "../ui/prompts";
import chalk from "chalk";
import { AuthApi } from "../services/auth.api";

async function promptToken(tokenArg?: string): Promise<string> {
  if (tokenArg) return tokenArg;
  const tokenInput = await text({
    message: "Enter Reset Token:",
    placeholder: "Paste the token from your email",
    validate: (val) => (val.trim().length === 0 ? "Token is required" : undefined),
  });
  if (isCancel(tokenInput)) {
    throw new Error("CANCELLED");
  }
  return tokenInput;
}

async function promptNewPassword(): Promise<string> {
  const pwdInput = await password({
    message: "Enter New Password:",
    validate: (val) => (val.length < 8 ? "Password must be at least 8 characters" : undefined),
  });
  if (isCancel(pwdInput)) {
    throw new Error("CANCELLED");
  }
  return pwdInput;
}

async function promptConfirmPassword(pwdInput: string): Promise<string> {
  const pwdConfirm = await password({
    message: "Confirm New Password:",
    validate: (val) => val === pwdInput ? undefined : "Passwords do not match",
  });
  if (isCancel(pwdConfirm)) {
    throw new Error("CANCELLED");
  }
  return pwdConfirm;
}

export const resetCommand = new Command("reset")
  .description("Reset account password using a valid reset token")
  .argument("[token]", "Password reset token")
  .action(async (tokenArg?: string) => {
    try {
      await intro(chalk.cyan("Orazaka Password Reset"));

      const token = await promptToken(tokenArg);
      const pwd = await promptNewPassword();
      await promptConfirmPassword(pwd);

      const s = await createSpinner();
      s.start("Resetting password...");

      try {
        const result = await AuthApi.resetPassword(token, pwd);
        s.stop("Password reset success!");
        await outro(chalk.green(`✓ ${result.message}`));
        await outro(chalk.yellow("You can now login with your new password: orazaka login"));
      } catch (err: unknown) {
        s.stop("Password reset failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        await outro(chalk.red(`❌ Password Reset Failed: ${msg}`));
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "CANCELLED") {
        await outro(chalk.red("Password reset cancelled."));
        return;
      }
      throw err;
    }
  });
