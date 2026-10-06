/**
 * @file settings.command.ts
 * @description Command to query and modify user settings/preferences.
 */

import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import { requireAuth } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { Logger } from "../ui/logger";
import { Box } from "../ui/box";

export const settingsCommand = new Command("settings")
  .description("Manage user settings and preferences");

settingsCommand
  .command("get")
  .description("Get all settings and preferences")
  .action(async () => {
    requireAuth();
    const s = await createSpinner();
    s.start("Retrieving settings...");

    try {
      const user = await SettingsApi.getMe();
      s.stop("Settings retrieved");

      const items: Array<string | { key: string; value: string }> = [
        { key: "User ID", value: user.id },
        { key: "Email", value: user.email },
        { key: "Authorities", value: user.authorities?.join(", ") || "None" },
      ];

      const prefs = user.preferences || {};
      const entries = Object.entries(prefs);
      if (entries.length > 0) {
        items.push("Preferences:");
        for (const [k, v] of entries) {
          items.push({ key: `  ${k}`, value: String(v) });
        }
      } else {
        items.push("No preferences configured.");
      }

      Box.render(`Orazaka Settings for User: ${user.username}`, items, {
        borderColor: "yellow",
        titleColor: "white",
      });
    } catch (err: unknown) {
      s.stop("Failed to retrieve settings");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to retrieve settings: ${msg}`);
      process.exit(1);
    }
  });

settingsCommand
  .command("set")
  .description("Set a user preference key-value pair")
  .argument("<key>", "Preference key to set")
  .argument("<value>", "Preference value to set")
  .action(async (key: string, rawValue: string) => {
    requireAuth();
    const s = await createSpinner();
    s.start(`Updating preference "${key}"...`);

    // Coerce boolean and numeric strings to native types
    const coerceValue = (val: string): string | number | boolean => {
      if (val.toLowerCase() === "true") return true;
      if (val.toLowerCase() === "false") return false;
      if (!Number.isNaN(Number(val))) return Number(val);
      return val;
    };
    const typedValue = coerceValue(rawValue);

    try {
      // Direct atomic merge
      await SettingsApi.updatePreferences({ [key]: typedValue });
      s.stop("Preference updated");
      Logger.success(`Preference "${key}" updated to: ${rawValue}`);
    } catch (err: unknown) {
      s.stop("Failed to update preference");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to update preference: ${msg}`);
      process.exit(1);
    }
  });
