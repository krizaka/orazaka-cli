/**
 * @file studio.api.ts
 * @description Outbound adapter service for the Studio marketplace (ADR-034).
 */

import { ApiClient } from "./api-client";

export interface StudioSummaryResponse {
  readonly studioKey: string;
  readonly label: string;
  readonly tagline: string | null;
  readonly profession: string;
  readonly pricing: string;
  readonly latestVersion: string | null;
  readonly locked: boolean;
  readonly lockedReason: string;
  readonly packKey: string | null;
}

export interface InstallationResponse {
  readonly id: string;
  readonly studioKey: string;
  readonly label: string;
  readonly pinnedVersion: string;
  readonly latestVersion: string | null;
  readonly status: string;
  readonly lastRunAt: string | null;
}

export interface RunStepResponse {
  readonly stepId: string;
  readonly ordinal: number;
  readonly jobId: string | null;
  readonly status: string;
  readonly error: string | null;
}

export interface RunResponse {
  readonly id: string;
  readonly studioKey: string;
  readonly blueprintVersion: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly errorMessage: string | null;
  readonly steps: readonly RunStepResponse[];
  readonly outputs: readonly RunArtefactResponse[];
}

/**
 * One button of the composer, as the platform serves it (ADR-068 §3).
 *
 * The CLI reads the same row the chat bar does, for the same reason: what this
 * deployment can run in one step is a property of the Studios installed here, not a
 * list compiled into a client. A CLI that hardcoded its own would go out of date the
 * first time a pack shipped.
 */
export interface ComposerStudioResponse {
  readonly studioKey: string;
  readonly label: string;
  readonly iconKey: string;
  readonly version: string;
  readonly capabilityKey: string;
  readonly inputKey: string;
  readonly inputKind: "TEXT" | "ASSET";
  readonly promptKey: string | null;
  readonly available: boolean;
  readonly lockedReason: string;
}

/** One produced artefact with the presentation its blueprint declared. */
export interface RunArtefactResponse {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly value: string;
}

export const StudioApi = {
  /** The Studios this deployment can launch from a single input, for this actor. */
  composer: async (locale = "fr"): Promise<ComposerStudioResponse[]> => {
    return ApiClient.requestRest<ComposerStudioResponse[]>({
      method: "GET",
      path: `/api/v1/studios/composer?locale=${encodeURIComponent(locale)}`,
    });
  },

  /**
   * Starts a run of a Studio by key.
   *
   * The only door: a TOOLKIT Studio has no installation row to address, and since
   * ADR-068 there is no capability endpoint to POST to either.
   */
  startStudioRun: async (
    studioKey: string,
    inputs: Record<string, unknown>,
  ): Promise<RunResponse> => {
    return ApiClient.requestRest<RunResponse>({
      method: "POST",
      path: `/api/v1/studios/${encodeURIComponent(studioKey)}/runs`,
      body: { inputs },
    });
  },

  /** The catalogue, locked entries included so the CLI can show what is worth buying. */
  list: async (profession?: string): Promise<StudioSummaryResponse[]> => {
    const query = profession ? `?profession=${encodeURIComponent(profession)}` : "";
    return ApiClient.requestRest<StudioSummaryResponse[]>({
      method: "GET",
      path: `/api/v1/studios${query}`,
    });
  },

  /** What this user has installed. */
  installations: async (): Promise<InstallationResponse[]> => {
    return ApiClient.requestRest<InstallationResponse[]>({
      method: "GET",
      path: "/api/v1/studios/installations",
    });
  },

  /** Installs a Studio, pinning its newest published version. */
  install: async (
    studioKey: string,
    config: Record<string, string>,
  ): Promise<InstallationResponse> => {
    return ApiClient.requestRest<InstallationResponse>({
      method: "POST",
      path: `/api/v1/studios/${encodeURIComponent(studioKey)}/installations`,
      body: { config },
    });
  },

  /** Starts a run and returns immediately with its id — a run outlives the command. */
  run: async (
    installationId: string,
    inputs: Record<string, unknown>,
  ): Promise<RunResponse> => {
    return ApiClient.requestRest<RunResponse>({
      method: "POST",
      path: `/api/v1/studios/installations/${encodeURIComponent(installationId)}/runs`,
      body: { inputs },
    });
  },

  /** One run with its per-step states. */
  runDetail: async (runId: string): Promise<RunResponse> => {
    return ApiClient.requestRest<RunResponse>({
      method: "GET",
      path: `/api/v1/studios/runs/${encodeURIComponent(runId)}`,
    });
  },

  /** This user's run history. */
  runs: async (): Promise<RunResponse[]> => {
    return ApiClient.requestRest<RunResponse[]>({
      method: "GET",
      path: "/api/v1/studios/runs",
    });
  },
} as const;
