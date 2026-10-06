/**
 * @file composer.run.ts
 * @description Runs a one-step Studio from the CLI and waits for what it produced (ADR-068 §4).
 *
 * What replaced `media.api.ts`. That file held five POSTs to `/api/v1/media/**` — the
 * door that took a capability call straight to the job plane, with no run, no data class,
 * no retention, no audit trail and no scope guard. The CLI now starts a run like every
 * other client, and the blueprint decides what happens next.
 *
 * Which Studio runs a given capability is asked of the platform rather than compiled in:
 * `/api/v1/studios/composer` already answers "what can this deployment launch from a single
 * input", and a CLI carrying its own list would go out of date the first time a pack shipped.
 * The capability keys below are the CLI's flags, not a heuristic — `--image` means the image
 * capability, and the platform says which Studio runs it here.
 */

import { StudioApi, type ComposerStudioResponse, type RunResponse } from "./studio.api";

/** The capability each media flag means. Identities, declared in the registry — not spellings. */
export const CAPABILITY = {
  image: "orazaka.core.media.image",
  video: "orazaka.core.media.video",
  speech: "orazaka.core.media.speech",
  vision: "orazaka.core.media.vision",
  audio: "orazaka.core.media.audio.analysis",
} as const;

/** How often a live run is re-read, and for how long before the CLI gives up. */
const POLL_MS = 3000;
const MAX_ATTEMPTS = 240;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/** The Studio this deployment runs that capability with. */
async function studioFor(capabilityKey: string): Promise<ComposerStudioResponse> {
  const row = await StudioApi.composer();
  const studio = row.find((entry) => entry.capabilityKey === capabilityKey);
  if (!studio) {
    throw new Error(
      `No Studio installed here runs ${capabilityKey}. Install the pack that ships it ` +
        `(orazaka pack install <bundle>), then try again.`,
    );
  }
  if (!studio.available) {
    throw new Error(`${studio.label} is not available on this plan (${studio.lockedReason}).`);
  }
  return studio;
}

/**
 * Starts a run and waits for it.
 *
 * @param capabilityKey - the capability the flag means; the platform names the Studio
 * @param primary - the prompt, or the id of an uploaded asset, per what the Studio asks for
 * @param options - optional inputs the user chose, sent only when set
 * @param onStatus - called with each observed run status, for a spinner
 * @returns the finished run
 */
export async function runComposerStudio({
  capabilityKey,
  primary,
  prompt,
  options,
  onStatus,
}: Readonly<{
  capabilityKey: string;
  primary: string;
  prompt?: string;
  options?: Record<string, unknown>;
  onStatus?: (status: string) => void;
}>): Promise<RunResponse> {
  const studio = await studioFor(capabilityKey);

  const inputs: Record<string, unknown> = { [studio.inputKey]: primary };
  if (studio.promptKey && studio.promptKey !== studio.inputKey && prompt?.trim()) {
    inputs[studio.promptKey] = prompt;
  }
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined && value !== "") {
      inputs[key] = value;
    }
  }

  const started = await StudioApi.startStudioRun(studio.studioKey, inputs);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const run = await StudioApi.runDetail(started.id);
    onStatus?.(run.status);
    if (run.status === "SUCCEEDED") {
      return run;
    }
    if (TERMINAL.has(run.status)) {
      throw new Error(run.errorMessage || `${studio.label} run ${run.status.toLowerCase()}`);
    }
    if (run.status === "AWAITING_INPUT") {
      // A one-step Studio has no approval step and cannot reach this. If one ever does,
      // the CLI says where the answer is given rather than polling a parked run forever.
      throw new Error(
        `${studio.label} is waiting for an answer: orazaka studio run ${started.id}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${studio.label} run timed out after ${(MAX_ATTEMPTS * POLL_MS) / 1000}s`);
}

/**
 * The first artefact a finished run produced, as text.
 *
 * A URL for media, the analysis for a text output — read off the artefact the blueprint
 * declared rather than sniffed out of a result map, which is what the job path had to do.
 */
export function firstOutput(run: RunResponse): string {
  return run.outputs[0]?.value ?? "";
}
