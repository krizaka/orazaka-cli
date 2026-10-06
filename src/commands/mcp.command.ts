/**
 * @file mcp.command.ts
 * @description Command to manage user private MCP server connections.
 */

import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import { requireAuth } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { McpApi } from "../services/mcp.api";
import { Logger } from "../ui/logger";
import { Box } from "../ui/box";

export const mcpCommand = new Command("mcp")
  .description("Manage your private dynamic MCP server connections");

mcpCommand
  .command("list")
  .description("List your registered private MCP servers")
  .action(async () => {
    requireAuth();
    const s = await createSpinner();
    s.start("Retrieving your MCP servers...");

    try {
      const servers = await McpApi.listUserServers();
      s.stop("MCP servers retrieved");

      const items: Array<string | { key: string; value: string }> = [];

      if (servers.length === 0) {
        items.push("No private MCP servers registered.");
      } else {
        for (const srv of servers) {
          items.push({ key: `ID: ${srv.id} [${srv.label}]`, value: srv.url });
          if (srv.authToken) {
            items.push({ key: "  Auth Token", value: "********" });
          }
          items.push({ key: "  Status", value: srv.enabled ? "Enabled" : "Disabled" });
        }
      }

      Box.render("My Private MCP Servers", items, {
        borderColor: "cyan",
        titleColor: "white",
      });
    } catch (err: unknown) {
      s.stop("Failed to retrieve MCP servers");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to retrieve MCP servers: ${msg}`);
      process.exit(1);
    }
  });

mcpCommand
  .command("register")
  .description("Register a new private MCP server")
  .requiredOption("--label <label>", "Unique friendly label for the server")
  .requiredOption("--url <url>", "Remote SSE/URL transport endpoint (e.g. http://localhost:3000/sse)")
  .option("--auth-token <token>", "Optional authorization token/header")
  .action(async (options: { label: string; url: string; authToken?: string }) => {
    requireAuth();
    const s = await createSpinner();
    s.start("Fetching user profile...");

    try {
      const user = await SettingsApi.getMe();
      s.message("Registering MCP server...");

      const newServer = await McpApi.registerUserServer({
        userId: user.id,
        label: options.label,
        url: options.url,
        authToken: options.authToken,
        enabled: true,
      });

      s.stop("MCP server registered successfully");
      Logger.success(`Successfully registered MCP server: ${newServer.label} (ID: ${newServer.id})`);
    } catch (err: unknown) {
      s.stop("Failed to register MCP server");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to register MCP server: ${msg}`);
      process.exit(1);
    }
  });

mcpCommand
  .command("delete <id>")
  .description("Delete a private MCP server by ID")
  .action(async (idStr: string) => {
    requireAuth();
    const id = Number.parseInt(idStr, 10);
    if (Number.isNaN(id)) {
      Logger.error("Invalid server ID. Must be a number.");
      process.exit(1);
    }

    const s = await createSpinner();
    s.start(`Deleting MCP server ID ${id}...`);

    try {
      await McpApi.deleteUserServer(id);
      s.stop("MCP server deleted successfully");
      Logger.success(`Successfully deleted MCP server ID ${id}`);
    } catch (err: unknown) {
      s.stop("Failed to delete MCP server");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Failed to delete MCP server: ${msg}`);
      process.exit(1);
    }
  });
