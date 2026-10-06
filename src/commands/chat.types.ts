/**
 * Parsed arguments from CLI input for chat command execution.
 */
export interface ParsedArgs {
  readonly flag?: string;
  readonly flagValue?: string;
  readonly prompt: string;
  readonly savePath?: string;
  readonly model?: string;
  readonly voice?: string;
}

/**
 * Capability descriptor mapping CLI flags to Operation Graph nodes.
 */
export interface CapabilityDescriptor {
  readonly flag: string;
  readonly id: string;
  readonly renderKind: string;
  readonly responseField: string;
}

/**
 * Registry of all supported chat capabilities.
 *
 * Two of these ids named capabilities that have never existed — `orazaka.core.chat.text` and
 * `orazaka.core.chat.image`, where the registry has `orazaka.core.chat.completion` and
 * `orazaka.core.media.image`. Both flags therefore failed with "not found in Operation Graph"
 * rather than running; corrected while enumerating the references of the two keys #44 renamed
 * (ADR-069 §3), which is what an enumeration is for.
 */
export const CAPABILITIES: readonly CapabilityDescriptor[] = [
  { flag: "--text", id: "orazaka.core.chat.completion", renderKind: "text", responseField: "content" },
  { flag: "--image", id: "orazaka.core.media.vision", renderKind: "image", responseField: "analysis" },
  { flag: "--audio", id: "orazaka.core.media.audio.analysis", renderKind: "audio", responseField: "analysis" },
  { flag: "--gen-image", id: "orazaka.core.media.image", renderKind: "image", responseField: "content" },
  { flag: "--speech", id: "orazaka.core.media.speech", renderKind: "audio", responseField: "content" },
] as const;

/**
 * Resolves the active flag from commander options.
 * Eliminates nested ternary chains (S3358).
 */
export function resolveActiveFlag(options: {
  readonly text?: boolean;
  readonly image?: string;
  readonly audio?: string;
  readonly genImage?: boolean;
  readonly speech?: boolean;
}): string | undefined {
  if (options.image) return "--image";
  if (options.audio) return "--audio";
  if (options.genImage) return "--gen-image";
  if (options.speech) return "--speech";
  if (options.text) return "--text";
  return undefined;
}

/**
 * Resolves the flag value for media flags (path-based).
 */
export function resolveFlagValue(options: {
  readonly image?: string;
  readonly audio?: string;
}): string | undefined {
  return options.image || options.audio;
}
