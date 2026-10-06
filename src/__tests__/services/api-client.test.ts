/**
 * @file api-client.test.ts
 * @description Tests for ApiClient — REST, GraphQL, and file upload methods.
 */

import { ApiClient } from "../../services/api-client";

// ── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// ── Mock threads (loadConfig) ────────────────────────────────────────────────

jest.mock("../../threads", () => ({
  loadConfig: jest.fn(() => ({ token: "test-jwt-token", username: "testuser" })),
}));

const BASE_URL = "http://localhost:8080";

jest.mock("../../utils/config", () => ({
  ROUTER_URL: "http://localhost:8080",
}));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ApiClient.requestRest", () => {
  test("sends GET request with auth header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: "ok" }),
    });

    const result = await ApiClient.requestRest({ method: "GET", path: "/api/v1/test" });

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/test`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-jwt-token",
        }),
      }),
    );
    expect(result).toEqual({ data: "ok" });
  });

  test("sends POST request with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    await ApiClient.requestRest({
      method: "POST",
      path: "/api/v1/create",
      body: { name: "test" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/create`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "test" }),
      }),
    );
  });

  test("throws on non-ok response with error body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    await expect(
      ApiClient.requestRest({ method: "GET", path: "/api/v1/secure" }),
    ).rejects.toThrow("Unauthorized");
  });

  test("throws generic message when error body has no error field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(
      ApiClient.requestRest({ method: "GET", path: "/api/v1/fail" }),
    ).rejects.toThrow("HTTP request failed: status 500");
  });

  test("handles json() failure on error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => { throw new Error("parse error"); },
    });

    await expect(
      ApiClient.requestRest({ method: "GET", path: "/api/v1/broken" }),
    ).rejects.toThrow("HTTP request failed: status 502");
  });

  test("sends request without Authorization header if config has no token", async () => {
    const { loadConfig } = require("../../threads");
    (loadConfig as jest.Mock).mockReturnValueOnce(null);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: "ok" }),
    });

    await ApiClient.requestRest({ method: "GET", path: "/api/v1/test" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});

describe("ApiClient.requestGql", () => {
  test("sends GraphQL query and returns data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { users: [{ id: "1" }] } }),
    });

    const result = await ApiClient.requestGql<{ users: Array<{ id: string }> }>(
      "query { users { id } }",
    );

    expect(result).toEqual({ users: [{ id: "1" }] });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/graphql`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "query { users { id } }", variables: undefined }),
      }),
    );
  });

  test("sends variables with GraphQL query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { user: { id: "1" } } }),
    });

    await ApiClient.requestGql("query ($id: ID!) { user(id: $id) { id } }", { id: "1" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"variables":{"id":"1"}'),
      }),
    );
  });

  test("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(
      ApiClient.requestGql("query { me { id } }"),
    ).rejects.toThrow("GraphQL request failed: status 403");
  });

  test("throws on GraphQL errors array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: null,
        errors: [{ message: "Field 'x' not found" }],
      }),
    });

    await expect(
      ApiClient.requestGql("query { x }"),
    ).rejects.toThrow("Field 'x' not found");
  });

  test("throws when no data returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await expect(
      ApiClient.requestGql("query { empty }"),
    ).rejects.toThrow("No data returned from the GraphQL endpoint.");
  });

  test("sends GraphQL query without Authorization header if config has no token", async () => {
    const { loadConfig } = require("../../threads");
    (loadConfig as jest.Mock).mockReturnValueOnce({});
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    });

    await ApiClient.requestGql("query { test }");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});

describe("ApiClient.uploadFile", () => {
  const mockFs = jest.requireMock("fs") as { readFileSync: jest.Mock };

  beforeEach(() => {
    jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake-file-data"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("uploads a file and returns assetId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assetId: "asset-123" }),
    });

    const result = await ApiClient.uploadFile("/tmp/test-file.txt");

    expect(result).toEqual({ assetId: "asset-123" });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/media/upload`,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  test("throws on non-ok upload response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: async () => "File too large",
    });

    await expect(
      ApiClient.uploadFile("/tmp/big-file.bin"),
    ).rejects.toThrow("Upload failed: status 413");
  });

  test("handles text() failure in error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => { throw new Error("body read failed"); },
    });

    await expect(
      ApiClient.uploadFile("/tmp/error-file.bin"),
    ).rejects.toThrow("Upload failed: status 500");
  });

  test("uploads file without Authorization header if config has no token", async () => {
    const { loadConfig } = require("../../threads");
    (loadConfig as jest.Mock).mockReturnValueOnce(undefined);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assetId: "asset-123" }),
    });

    await ApiClient.uploadFile("/tmp/test-file.txt");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});
