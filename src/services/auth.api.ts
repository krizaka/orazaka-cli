/**
 * @file auth.api.ts
 * @description Outbound adapter service for authentication and user onboarding.
 */

import { ApiClient } from "./api-client";
import type { RegisterResult, UserProfile } from "../types/api.types";

export interface LoginResponse {
  token: string;
  username: string;
}

export interface RegisterResponse {
  user: UserProfile | null;
  error: string | null;
}

export const AuthApi = {
  /**
   * Authenticates a user using email and password, returning the JWT token.
   */
  login: async (email: string, password: string): Promise<LoginResponse> => {
    return ApiClient.requestRest<LoginResponse>({
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email, password },
    });
  },

  /**
   * Registers a new user account with the orchestration backend.
   */
  register: async (
    username: string,
    email: string,
    password: string,
    language?: string,
  ): Promise<RegisterResult> => {
    // Note: The GraphQL registry has the register mutation.
    const query = `
      mutation Register(
        $username: String!
        $email: String!
        $password: String!
        $language: String
      ) {
        register(
          username: $username
          email: $email
          password: $password
          language: $language
        ) {
          user {
            id
            username
            email
            authorities
            preferences
          }
          error
        }
      }
    `;

    const data = await ApiClient.requestGql<{ register: RegisterResult }>(query, {
      username,
      email,
      password,
      language,
    });

    return data.register;
  },

  /**
   * Verifies a registration token manually.
   */
  verifyEmail: async (token: string): Promise<void> => {
    await ApiClient.requestRest<void>({
      method: "POST",
      path: "/api/v1/auth/verify",
      body: { token },
    });
  },

  /**
   * Initiates a password reset request. Always returns a generic message.
   */
  forgotPassword: async (email: string): Promise<{ message: string }> => {
    return ApiClient.requestRest<{ message: string }>({
      method: "POST",
      path: "/api/v1/auth/forgot",
      body: { email },
    });
  },

  /**
   * Executes a password reset using the plaintext token and new password.
   */
  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    return ApiClient.requestRest<{ message: string }>({
      method: "POST",
      path: "/api/v1/auth/reset",
      body: { token, newPassword },
    });
  },
} as const;
