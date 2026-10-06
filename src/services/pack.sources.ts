/**
 * @file pack.sources.ts
 * @description Where this deployment's packs come from — `orazaka.packs.sources` (ADR-049).
 *
 * The one line that separates an OSS deployment from a cloud one. An OSS install lists local
 * directories; a cloud install lists a registry as well. Nothing else in the tree changes, which
 * is the whole claim of the open-core split: a cloud pack is never a core patch.
 *
 * Read from ORAZAKA_PACKS_SOURCES, comma-separated, in priority order. A source is either a
 * directory path or `registry:<url>`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { strEnv } from "../utils/config";

/** The default an untouched clone runs with: this repository's own reference packs. */
export const DEFAULT_SOURCE = "orazaka-packs";

const REGISTRY_PREFIX = "registry:";

/** One place packs are looked for. */
export interface PackSource {
  readonly kind: "directory" | "registry";
  /** The directory path, or the registry URL. */
  readonly location: string;
  /** Why this source cannot be used here, when it cannot. */
  readonly unavailable?: string;
}

/**
 * This deployment's pack sources, in the order they are searched.
 *
 * @returns every configured source, including ones this deployment cannot serve
 */
export function packSources(): PackSource[] {
  return strEnv("ORAZAKA_PACKS_SOURCES", DEFAULT_SOURCE)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry.startsWith(REGISTRY_PREFIX)
        ? {
            kind: "registry" as const,
            location: entry.slice(REGISTRY_PREFIX.length),
            // Named, not silently skipped: a deployment that thinks it has a registry and
            // quietly resolves nothing is worse than one that says the control plane is absent.
            unavailable:
              "registry sources need the cloud control plane; this deployment is local (AGENTS.md §0)",
          }
        : { kind: "directory" as const, location: entry },
    );
}

/** A bundle found in a source: a directory holding pack.yaml. */
export interface DiscoveredBundle {
  readonly directory: string;
  readonly source: string;
}

/**
 * Every bundle the configured sources offer.
 *
 * <p>A directory that does not exist is skipped rather than fatal: sources are a deployment's
 * declaration of where it looks, and looking somewhere empty is not an error.
 *
 * @returns the bundles, in source order
 */
export function discoverBundles(): DiscoveredBundle[] {
  const found: DiscoveredBundle[] = [];
  for (const source of packSources()) {
    if (source.kind !== "directory" || !fs.existsSync(source.location)) {
      continue;
    }
    for (const entry of fs.readdirSync(source.location, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const directory = path.join(source.location, entry.name);
      if (fs.existsSync(path.join(directory, "pack.yaml"))) {
        found.push({ directory, source: source.location });
      }
    }
  }
  return found;
}
