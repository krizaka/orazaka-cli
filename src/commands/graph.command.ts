/**
 * @file graph.command.ts
 * @description Command to fetch and display the Operation Graph and its capability states.
 */

import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import chalk from "chalk";
import { requireAuth } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { Logger } from "../ui/logger";
import { Box } from "../ui/box";

export const graphCommand = new Command("graph")
  .description("Display Operation Graph capability matrix")
  .action(async () => {
    requireAuth();

    const s = await createSpinner();
    s.start("Loading Operation Graph...");

    try {
      const nodes = await SettingsApi.getOperationGraph();
      s.stop("Operation Graph loaded");

      const visibleNodes = nodes.filter((n) => n.state.type !== "INVISIBLE");
      const items: Array<string | { key: string; value: string }> = [];

      if (visibleNodes.length === 0) {
        items.push("No active capabilities returned by the engine.");
      } else {
        for (const node of visibleNodes) {
          const stateTag = node.state.type === "ACTIVE"
            ? chalk.green("● ACTIVE ")
            : chalk.red("○ LOCKED ");

          items.push(`${stateTag} ${chalk.bold(node.id)}`);

          if (node.state.type === "LOCKED" && node.state.reason) {
            const reasonText = chalk.gray(`Reason: ${node.state.reason}`);
            items.push(`           ${reasonText}`);
          }

        }
      }

      items.push(`Total: ${visibleNodes.length} visible / ${nodes.length} total capabilities`);

      Box.render("🥷 ORAZAKA OPERATION GRAPH", items, {
        borderColor: "cyan",
        titleColor: "white",
      });
    } catch (err: unknown) {
      s.stop("Failed to load Operation Graph");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to load Operation Graph: ${msg}`);
      process.exit(1);
    }
  });
