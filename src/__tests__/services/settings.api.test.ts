/**
 * @file settings.api.test.ts
 * @description Tests for SettingsApi — profile, operation graph, interceptions, preferences.
 */

import { SettingsApi } from "../../services/settings.api";
import { ApiClient } from "../../services/api-client";

jest.mock("../../services/api-client");

const mockRequestGql = ApiClient.requestGql as jest.MockedFunction<typeof ApiClient.requestGql>;

beforeEach(() => jest.clearAllMocks());

describe("SettingsApi", () => {
  test("getMe fetches current user profile via GraphQL", async () => {
    const profile = { id: "u1", username: "admin", email: "a@b.com", authorities: ["USER"], preferences: null };
    mockRequestGql.mockResolvedValue({ me: profile });

    const result = await SettingsApi.getMe();

    expect(mockRequestGql).toHaveBeenCalledWith(expect.stringContaining("GetMe"));
    expect(result).toEqual(profile);
  });

  test("getOperationGraph fetches nodes via GraphQL", async () => {
    const nodes = [
      {
        id: "chat.image",
        label: "Image",
        icon: "image",
        presentationContext: "playground",
        state: { type: "ACTIVE" },
        executionDetails: { uriPath: "/api", httpMethod: "POST" },
      },
    ];
    mockRequestGql.mockResolvedValue({ operationGraph: { nodes } });

    const result = await SettingsApi.getOperationGraph();

    expect(mockRequestGql).toHaveBeenCalledWith(expect.stringContaining("GetOperationGraph"));
    expect(result).toEqual(nodes);
  });

  test("getInterceptionSchema fetches schema by ID", async () => {
    mockRequestGql.mockResolvedValue({ interceptionSchema: '{"field":"value"}' });

    const result = await SettingsApi.getInterceptionSchema("schema-1");

    expect(mockRequestGql).toHaveBeenCalledWith(
      expect.stringContaining("GetInterceptionSchema"),
      { schemaId: "schema-1" },
    );
    expect(result).toBe('{"field":"value"}');
  });

  test("getInterceptionSchema returns null when not found", async () => {
    mockRequestGql.mockResolvedValue({ interceptionSchema: null });

    const result = await SettingsApi.getInterceptionSchema("missing");
    expect(result).toBeNull();
  });

  test("updatePreferences calls mutation with prefs", async () => {
    const profile = { id: "u1", username: "admin", email: "a@b.com", authorities: ["USER"], preferences: { theme: "dark" } };
    mockRequestGql.mockResolvedValue({ updatePreferences: profile });

    const result = await SettingsApi.updatePreferences({ theme: "dark" });

    expect(mockRequestGql).toHaveBeenCalledWith(
      expect.stringContaining("UpdatePrefs"),
      { prefs: { theme: "dark" } },
    );
    expect(result).toEqual(profile);
  });

  test("resolveInterception calls mutation with all params", async () => {
    mockRequestGql.mockResolvedValue({ resolveInterception: true });

    const result = await SettingsApi.resolveInterception("ONBOARDING", "schema-1", { answer: "yes" });

    expect(mockRequestGql).toHaveBeenCalledWith(
      expect.stringContaining("ResolveInterception"),
      {
        interceptionType: "ONBOARDING",
        schemaId: "schema-1",
        responses: { answer: "yes" },
      },
    );
    expect(result).toBe(true);
  });
});
