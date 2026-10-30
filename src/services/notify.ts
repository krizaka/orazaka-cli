/**
 * @file notify.ts
 * @description A desktop notification through the OS, with no dependency (orazaka-cli#90 `--notify`):
 * Notification Center on macOS, `notify-send` on Linux; elsewhere the terminal bell.
 */

import { execFile } from "node:child_process";

/** The command that shows `title`/`message` on this platform, or null when the OS has none. */
export function notifyCommand(
  platform: NodeJS.Platform,
  title: string,
  message: string,
): { file: string; args: string[] } | null {
  if (platform === "darwin") {
    // The text goes through argv, never into the script source, so a run name cannot inject AppleScript.
    return {
      file: "osascript",
      args: [
        "-e",
        "on run argv",
        "-e",
        "display notification (item 2 of argv) with title (item 1 of argv)",
        "-e",
        "end run",
        title,
        message,
      ],
    };
  }
  if (platform === "linux") return { file: "notify-send", args: [title, message] };
  return null;
}

/** Shows the notification; never throws: a missing notifier must not fail a run's command. */
export function notify(title: string, message: string, platform: NodeJS.Platform = process.platform): void {
  const command = notifyCommand(platform, title, message);
  if (!command) {
    process.stderr.write("\u0007");
    return;
  }
  execFile(command.file, command.args, () => {});
}

/** The words of the notification for how a followed run ended. */
export function outcomeMessage(outcome: string, name: string): string {
  switch (outcome) {
    case "finished":
      return `${name} finished`;
    case "failed":
      return `${name} failed`;
    case "cancelled":
      return `${name} was stopped`;
    default:
      return `${name} needs your approval`;
  }
}
