import { Command } from "commander";
import { intro, outro, text, createSpinner, isCancel } from "../ui/prompts";
import chalk from "chalk";
import { AuthApi } from "../services/auth.api";

async function promptToken(tokenArg?: string): Promise<string> {
  if (tokenArg) return tokenArg;
  const tokenInput = await text({
    message: "Enter Verification Token:",
    validate: (val) => (val.trim().length === 0 ? "Token is required" : undefined),
  });
  if (isCancel(tokenInput)) {
    throw new Error("CANCELLED");
  }
  return tokenInput;
}

export const verifyCommand = new Command("verify")
  .description("Verify account registration token")
  .argument("[token]", "Email verification token")
  .action(async (tokenArg?: string) => {
    try {
      await intro(chalk.cyan("Orazaka Email Verification"));

      const token = await promptToken(tokenArg);
      const s = await createSpinner();
      s.start("Verifying token...");

      try {
        await AuthApi.verifyEmail(token);
        s.stop("Verification success!");
        await outro(chalk.green("✓ Email verified successfully!"));
        await outro(chalk.yellow("You can now login: orazaka login"));
      } catch (err: unknown) {
        s.stop("Verification failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        await outro(chalk.red(`❌ Verification Failed: ${msg}`));
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "CANCELLED") {
        await outro(chalk.red("Verification cancelled."));
        return;
      }
      throw err;
    }
  });
