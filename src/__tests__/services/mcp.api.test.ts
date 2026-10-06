/**
 * @file mcp.api.test.ts
 * @description Tests for McpApi — MCP server management service.
 */

import { McpApi } from "../../services/mcp.api";
import { ApiClient } from "../../services/api-client";

jest.mock("../../services/api-client");

const mockRequestRest = ApiClient.requestRest as jest.MockedFunction<typeof ApiClient.requestRest>;

beforeEach(() => jest.clearAllMocks());

describe("McpApi", () => {
  test("listUserServers calls GET /api/v1/mcp/servers/user", async () => {
    const servers = [{ id: 1, userId: "u1", label: "Local", url: "http://localhost:3000" }];
    mockRequestRest.mockResolvedValue(servers);

    const result = await McpApi.listUserServers();

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/mcp/servers/user",
    });
    expect(result).toEqual(servers);
  });

  test("registerUserServer calls POST with server payload", async () => {
    const server = { userId: "u1", label: "Remote", url: "http://remote:3000" };
    const created = { ...server, id: 42 };
    mockRequestRest.mockResolvedValue(created);

    const result = await McpApi.registerUserServer(server);

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mcp/servers/user",
      body: server,
    });
    expect(result).toEqual(created);
  });

  test("deleteUserServer calls DELETE with server id", async () => {
    mockRequestRest.mockResolvedValue(undefined);

    await McpApi.deleteUserServer(42);

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/mcp/servers/user/42",
    });
  });
});
