import { Command } from "commander";
import { intro, outro, text, password, createSpinner, isCancel } from "../ui/prompts";
import chalk from "chalk";
import { AuthApi } from "../services/auth.api";
import { saveConfig } from "../threads";
import * as crypto from 'node:crypto';

async function promptEmail(emailArg?: string): Promise<string> {
  if (emailArg) return emailArg;
  const emailInput = await text({
    message: "Enter your email:",
    placeholder: "username@orazaka.com",
    validate: (val) => val.includes("@") ? undefined : "Invalid email address",
  });
  if (isCancel(emailInput)) {
    throw new Error("CANCELLED");
  }
  return emailInput;
}

async function promptPassword(passwordArg?: string): Promise<string> {
  if (passwordArg) return passwordArg;
  const pwdInput = await password({
    message: "Enter your password:",
    validate: (val) => (val.length < 8 ? "Password must be at least 8 chars" : undefined),
  });
  if (isCancel(pwdInput)) {
    throw new Error("CANCELLED");
  }
  return pwdInput;
}

export const loginCommand = new Command("login")
  .description("Authenticate and cache JWT token")
  .argument("[email]", "Account email address")
  .argument("[password]", "Account password")
  .action(async (emailArg?: string, passwordArg?: string) => {
    try {
      await intro(chalk.cyan("Orazaka Router Auth"));

      const email = await promptEmail(emailArg);
      const pwd = await promptPassword(passwordArg);

      const s = await createSpinner();
      s.start(`Authenticating user "${email}"...`);

      try {
        const response = await AuthApi.login(email, pwd);
        const threadId = crypto.randomUUID();

        saveConfig({
          token: response.token,
          username: response.username,
          activeThreadId: threadId,
          threads: [{ conversationId: threadId, title: "New Memory Block", updatedAt: Date.now() }],
        });

        s.stop("Authentication success!");
        await outro(chalk.green(`✓ Login successful! Token cached for user: ${response.username}`));
      } catch (err: unknown) {
        s.stop("Authentication failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        await outro(chalk.red(`❌ Authentication Failed: ${msg}`));
        process.exit(1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "CANCELLED") {
        await outro(chalk.red("Authentication cancelled."));
        return;
      }
      throw err;
    }
  });
