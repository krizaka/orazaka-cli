/**
 * @file auth.api.test.ts
 * @description Tests for AuthApi — login, register, verify, forgot, reset.
 */

import { AuthApi } from "../../services/auth.api";
import { ApiClient } from "../../services/api-client";

jest.mock("../../services/api-client");

const mockRequestRest = ApiClient.requestRest as jest.MockedFunction<typeof ApiClient.requestRest>;
const mockRequestGql = ApiClient.requestGql as jest.MockedFunction<typeof ApiClient.requestGql>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AuthApi.login", () => {
  test("calls POST /api/v1/auth/login with credentials", async () => {
    mockRequestRest.mockResolvedValueOnce({ token: "jwt-abc", username: "alice" });

    const result = await AuthApi.login("alice@example.com", "pass123");

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: "alice@example.com", password: "pass123" },
    });
    expect(result).toEqual({ token: "jwt-abc", username: "alice" });
  });
});

describe("AuthApi.register", () => {
  test("sends GraphQL register mutation with all fields", async () => {
    mockRequestGql.mockResolvedValueOnce({
      register: {
        user: { id: "1", username: "bob", email: "bob@x.com", authorities: ["USER"], preferences: null },
        error: null,
      },
    });

    const result = await AuthApi.register("bob", "bob@x.com", "securepass", "en");

    expect(mockRequestGql).toHaveBeenCalledWith(
      expect.stringContaining("mutation Register"),
      expect.objectContaining({ username: "bob", email: "bob@x.com", password: "securepass", language: "en" }),
    );
    expect(result.user?.username).toBe("bob");
    expect(result.error).toBeNull();
  });

  test("handles registration error", async () => {
    mockRequestGql.mockResolvedValueOnce({
      register: { user: null, error: "Email already exists" },
    });

    const result = await AuthApi.register("bob", "bob@x.com", "pass");

    expect(result.error).toBe("Email already exists");
    expect(result.user).toBeNull();
  });
});

describe("AuthApi.verifyEmail", () => {
  test("sends POST /api/v1/auth/verify", async () => {
    mockRequestRest.mockResolvedValueOnce(undefined);

    await AuthApi.verifyEmail("verify-token-123");

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/auth/verify",
      body: { token: "verify-token-123" },
    });
  });
});

describe("AuthApi.forgotPassword", () => {
  test("sends POST /api/v1/auth/forgot", async () => {
    mockRequestRest.mockResolvedValueOnce({ message: "If this email exists..." });

    const result = await AuthApi.forgotPassword("user@example.com");

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/auth/forgot",
      body: { email: "user@example.com" },
    });
    expect(result.message).toContain("If this email");
  });
});

describe("AuthApi.resetPassword", () => {
  test("sends POST /api/v1/auth/reset", async () => {
    mockRequestRest.mockResolvedValueOnce({ message: "Password updated" });

    const result = await AuthApi.resetPassword("token-xyz", "newSecure123!");

    expect(mockRequestRest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/auth/reset",
      body: { token: "token-xyz", newPassword: "newSecure123!" },
    });
    expect(result.message).toBe("Password updated");
  });
});
