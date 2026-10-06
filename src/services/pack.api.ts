/**
 * @file pack.api.ts
 * @description Outbound adapter for the pack install surface (ADR-037, seam S4).
 */

import { ApiClient } from "./api-client";
import type { PackBundle } from "./pack.bundle";

/** What the service found when checking a bundle against this platform. */
export interface PackValidationResponse {
  readonly packKey: string;
  readonly version: string;
  readonly valid: boolean;
  readonly problems: readonly string[];
}

/** What an install applied. */
export interface PackInstallResponse {
  readonly packKey: string;
  readonly version: string;
  readonly studiosInstalled: number;
}

const BUNDLES = "/api/v1/studios/packs/bundles";

export const PackApi = {
  /** The semantic half of validation: do this platform's capabilities resolve for this bundle? */
  validate: async (bundle: PackBundle): Promise<PackValidationResponse> =>
    ApiClient.requestRest<PackValidationResponse>({
      method: "POST",
      path: `${BUNDLES}/validation`,
      body: bundle,
    }),

  /** Applies a bundle: capabilities, billing, catalogue — or none of them. */
  install: async (bundle: PackBundle): Promise<PackInstallResponse> =>
    ApiClient.requestRest<PackInstallResponse>({
      method: "POST",
      path: BUNDLES,
      body: bundle,
    }),
};
