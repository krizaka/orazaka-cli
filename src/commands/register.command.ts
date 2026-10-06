import { Command } from "commander";
import { intro, outro, text, password, createSpinner, isCancel } from "../ui/prompts";
import chalk from "chalk";
import { AuthApi } from "../services/auth.api";

async function promptUsername(usernameArg?: string): Promise<string> {
  if (usernameArg) return usernameArg;
  const usernameInput = await text({
    message: "Choose Username:",
    validate: (val) => (val.trim().length === 0 ? "Username is required" : undefined),
  });
  if (isCancel(usernameInput)) {
    throw new Error("CANCELLED");
  }
  return usernameInput;
}

async function promptEmail(emailArg?: string): Promise<string> {
  if (emailArg) return emailArg;
  const emailInput = await text({
    message: "Enter Email:",
    validate: (val) => val.includes("@") ? undefined : "Invalid email address",
  });
  if (isCancel(emailInput)) {
    throw new Error("CANCELLED");
  }
  return emailInput;
}

async function promptPassword(): Promise<string> {
  const pwdInput = await password({
    message: "Choose Password:",
    validate: (val) => (val.length < 8 ? "Password must be at least 8 characters" : undefined),
  });
  if (isCancel(pwdInput)) {
    throw new Error("CANCELLED");
  }
  return pwdInput;
}

async function promptConfirmPassword(pwdInput: string): Promise<string> {
  const pwdConfirm = await password({
    message: "Confirm Password:",
    validate: (val) => val === pwdInput ? undefined : "Passwords do not match",
  });
  if (isCancel(pwdConfirm)) {
    throw new Error("CANCELLED");
  }
  return pwdConfirm;
}

export const registerCommand = new Command("register")
  .description("Register a new user account")
  .argument("[username]", "Desired username")
  .argument("[email]", "Account email address")
  .option("-l, --language <lang>", "BCP 47 language tag (e.g. en, ja)")
  .action(async (usernameArg?: string, emailArg?: string, options?: { language?: string }) => {
    try {
      await intro(chalk.cyan("Orazaka Account Registration"));

      const username = await promptUsername(usernameArg);
      const email = await promptEmail(emailArg);
      const pwd = await promptPassword();
      await promptConfirmPassword(pwd);

      const s = await createSpinner();
      s.start(`Registering user "${username}"...`);

      try {
        const result = await AuthApi.register(username, email, pwd, options?.language);

        if (result.error) {
          s.stop("Registration failed");
          await outro(chalk.red(`❌ Registration Failed: ${result.error}`));
          process.exit(1);
        }

        s.stop("Registration success!");
        await outro(chalk.green(`✓ Registration successful for: ${result.user?.username || username}`));
        await outro(chalk.yellow("If email verification is enabled, run: orazaka verify <token>"));
      } catch (err: unknown) {
        s.stop("Registration failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        await outro(chalk.red(`❌ Registration Failed: ${msg}`));
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "CANCELLED") {
        await outro(chalk.red("Registration cancelled."));
        return;
      }
      throw err;
    }
  });
