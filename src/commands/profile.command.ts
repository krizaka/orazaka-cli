/**
 * @file profile.command.ts
 * @description Command to display the authenticated user's profile card.
 */

import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import { requireAuth } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { Box } from "../ui/box";
import { Logger } from "../ui/logger";

export const profileCommand = new Command("profile")
  .description("Display authenticated user profile information")
  .action(async () => {
    requireAuth();

    const s = await createSpinner();
    s.start("Loading profile...");

    try {
      const user = await SettingsApi.getMe();
      s.stop("Profile loaded");

      const items: Array<string | { key: string; value: string }> = [
        { key: "Username", value: user.username },
        { key: "Email", value: user.email },
        { key: "ID", value: user.id },
        { key: "Authorities", value: user.authorities.join(", ") || "None" },
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

      Box.render("🥷 ORAZAKA USER PROFILE", items, {
        borderColor: "cyan",
        titleColor: "white",
      });
    } catch (err: unknown) {
      s.stop("Failed to load profile");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to retrieve profile: ${msg}`);
      process.exit(1);
    }
  });
