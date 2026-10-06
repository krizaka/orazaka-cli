/**
 * @file api-client.ts
 * @description Base client for all REST and GraphQL outgoing requests to the Gateway.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from "../threads";
import { ROUTER_URL } from '../utils/config';

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export class ApiClient {
  /**
   * Uploads a file to the Gateway.
   */
  public static async uploadFile(filePath: string): Promise<{ assetId: string }> {
    const url = `${this.getBaseUrl()}/api/v1/media/upload`;
    const config = loadConfig();
    const headers: Record<string, string> = {
      ...(config?.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(config?.userId ? { "X-User-Id": config.userId } : {}),
    };

    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);
    formData.append("file", blob, path.basename(filePath));

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Upload failed: status ${response.status} - ${errText}`);
    }

    return response.json() as Promise<{ assetId: string }>;
  }
  private static getBaseUrl(): string {
    return ROUTER_URL;
  }

  /**
   * Executes a REST API request to the Gateway.
   */
  public static async requestRest<T>(options: RequestOptions): Promise<T> {
    const url = `${this.getBaseUrl()}${options.path}`;
    const config = loadConfig();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config?.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(config?.userId ? { "X-User-Id": config.userId } : {}),
    };

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      // `error` is the shape most handlers use; `message` + `cause` is what the Studio context's
      // RestErrorResolver returns. Reading only the first turned a 422 that named the failing
      // slice into "HTTP request failed: status 422", which is a diagnosis an operator has to go
      // and find in three services' logs.
      const detail = [errBody.error, errBody.message, errBody.cause]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" — ");
      throw new Error(detail || `HTTP request failed: status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Executes a GraphQL API request to the Gateway.
   */
  public static async requestGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `${this.getBaseUrl()}/graphql`;
    const config = loadConfig();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config?.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(config?.userId ? { "X-User-Id": config.userId } : {}),
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: status ${response.status}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors[0].message);
    }

    if (!json.data) {
      throw new Error("No data returned from the GraphQL endpoint.");
    }

    return json.data;
  }
}
