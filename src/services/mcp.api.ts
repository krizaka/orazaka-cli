/**
 * @file mcp.api.ts
 * @description Outbound adapter service for managing user-scoped dynamic MCP server configurations.
 */

import { ApiClient } from "./api-client";

export interface UserMcpServer {
  id?: number;
  userId: string;
  label: string;
  url: string;
  authToken?: string;
  enabled?: boolean;
}

export const McpApi = {
  /**
   * Lists all active user-scoped MCP servers.
   */
  listUserServers: async (): Promise<UserMcpServer[]> => {
    return ApiClient.requestRest<UserMcpServer[]>({
      method: "GET",
      path: "/api/v1/mcp/servers/user",
    });
  },

  /**
   * Registers a new user-scoped MCP server.
   */
  registerUserServer: async (server: UserMcpServer): Promise<UserMcpServer> => {
    return ApiClient.requestRest<UserMcpServer>({
      method: "POST",
      path: "/api/v1/mcp/servers/user",
      body: server,
    });
  },

  /**
   * Deletes a user-scoped MCP server.
   */
  deleteUserServer: async (id: number): Promise<void> => {
    await ApiClient.requestRest<void>({
      method: "DELETE",
      path: `/api/v1/mcp/servers/user/${id}`,
    });
  },
} as const;
