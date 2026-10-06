/**
 * @file settings.api.ts
 * @description Outbound adapter service for User Profile settings, Operation Graph, and Interception operations.
 */

import { ApiClient } from "./api-client";
import type { UserProfile, OperationNode } from "../types/api.types";

export const SettingsApi = {
  /**
   * Fetches the currently authenticated user's profile and preferences.
   */
  getMe: async (): Promise<UserProfile> => {
    const query = `
      query GetMe {
        me {
          id
          username
          email
          authorities
          preferences
        }
      }
    `;
    const data = await ApiClient.requestGql<{ me: UserProfile }>(query);
    return data.me;
  },

  /**
   * Fetches the compiled Operation Graph.
   */
  getOperationGraph: async (): Promise<OperationNode[]> => {
    const query = `
      query GetOperationGraph {
        operationGraph {
          nodes {
            id
            presentationContext
            state {
              type
              reason
              lockedAt
            }
          }
        }
      }
    `;
    const data = await ApiClient.requestGql<{ operationGraph: { nodes: OperationNode[] } }>(query);
    return data.operationGraph.nodes;
  },

  /**
   * Fetches an interception schema by ID.
   */
  getInterceptionSchema: async (schemaId: string): Promise<string | null> => {
    const query = `
      query GetInterceptionSchema($schemaId: String!) {
        interceptionSchema(schemaId: $schemaId)
      }
    `;
    const data = await ApiClient.requestGql<{ interceptionSchema: string | null }>(query, {
      schemaId,
    });
    return data.interceptionSchema;
  },

  /**
   * Updates user preferences via atomic merge mutation.
   */
  updatePreferences: async (preferences: Record<string, unknown>): Promise<UserProfile> => {
    const mutation = `
      mutation UpdatePrefs($prefs: Map!) {
        updatePreferences(preferences: $prefs) {
          id
          username
          email
          authorities
          preferences
        }
      }
    `;
    const data = await ApiClient.requestGql<{ updatePreferences: UserProfile }>(mutation, {
      prefs: preferences,
    });
    return data.updatePreferences;
  },

  /**
   * Resolves an active user interception.
   */
  resolveInterception: async (
    interceptionType: string,
    schemaId: string,
    responses: Record<string, unknown>,
  ): Promise<boolean> => {
    const mutation = `
      mutation ResolveInterception(
        $interceptionType: String!
        $schemaId: String!
        $responses: Map!
      ) {
        resolveInterception(
          interceptionType: $interceptionType
          schemaId: $schemaId
          responses: $responses
        )
      }
    `;
    const data = await ApiClient.requestGql<{ resolveInterception: boolean }>(mutation, {
      interceptionType,
      schemaId,
      responses,
    });
    return data.resolveInterception;
  },
} as const;
