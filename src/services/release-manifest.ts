/**
 * @file release-manifest.ts
 * @description The release manifest of an Orazaka bundle (docs/DELIVERY.md §5 in krizaka/orazaka).
 *
 * One version for the whole bundle: the manifest pins, for that version, every component's commit,
 * every container image by digest, every native artefact by SHA-256, every model by revision and
 * every pack by version. `orazaka install` and `orazaka update` read it; nothing is fetched by tag.
 *
 * This module checks the manifest's shape (JSON Schema) and the rules a schema cannot say, and
 * verifies the artefacts of an offline bundle against it. Its signature is the next step's.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { compareSemver, parseSemver, SEMVER_PATTERN } from "./semver";

export const RELEASE_SCHEMA = "orazaka.dev/release/v1";
export const RELEASE_TARGETS = ["mac-arm64", "linux-amd64", "linux-arm64"] as const;
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

export interface ReleaseImage {
  name: string;
  ref: string;
  digest: string;
  platforms: string[];
  gpu?: "none" | "cuda";
}

export interface ReleaseArtefact {
  name: string;
  file: string;
  sha256: string;
  size: number;
  target: ReleaseTarget;
}

export interface ReleaseManifest {
  schema: typeof RELEASE_SCHEMA;
  version: string;
  channel: "stable" | "candidate";
  releasedAt: string;
  upgradeFrom: string;
  cli: { package: string; version: string };
  targets: ReleaseTarget[];
  components: { name: string; repository: string; version: string; commit: string }[];
  images: ReleaseImage[];
  artefacts: ReleaseArtefact[];
  models: { id: string; source: "huggingface" | "ollama"; repo: string; revision: string; licence: string;
    commercialUse: true; downloadGb: number; hardware: ("metal" | "cuda" | "cpu")[] }[];
  packs: { key: string; version: string; distribution: "OSS" | "COMMERCIAL" }[];
}

const NAME = { type: "string", pattern: "^[a-z0-9][a-z0-9.-]*$" };
const SEMVER = { type: "string", pattern: SEMVER_PATTERN };
const SHA256 = { type: "string", pattern: "^[0-9a-f]{64}$" };
const list = (item: object) => ({ type: "array", items: item });
const record = (required: string[], properties: Record<string, object>) => ({
  type: "object", additionalProperties: false, required, properties,
});

/** The shape. Every field is required: a release that does not know a value has not been built yet. */
export const releaseManifestSchema = record(
  ["schema", "version", "channel", "releasedAt", "upgradeFrom", "cli", "targets", "components", "images",
    "artefacts", "models", "packs"],
  {
    schema: { const: RELEASE_SCHEMA },
    version: SEMVER,
    channel: { enum: ["stable", "candidate"] },
    releasedAt: { type: "string", format: "date-time" },
    upgradeFrom: SEMVER,
    cli: record(["package", "version"], { package: { type: "string", minLength: 1 }, version: SEMVER }),
    targets: { type: "array", minItems: 1, uniqueItems: true, items: { enum: [...RELEASE_TARGETS] } },
    components: list(record(["name", "repository", "version", "commit"], {
      name: NAME,
      repository: { type: "string", pattern: "^krizaka/[a-z0-9-]+$" },
      version: { type: "string", minLength: 1 },
      commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
    })),
    images: list(record(["name", "ref", "digest", "platforms"], {
      name: NAME,
      // Pinned by digest, never by tag: the ref is the repository, the digest is what runs.
      ref: { type: "string", pattern: "^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$" },
      digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      platforms: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["linux/amd64", "linux/arm64"] } },
      gpu: { enum: ["none", "cuda"] },
    })),
    artefacts: list(record(["name", "file", "sha256", "size", "target"], {
      name: NAME,
      file: { type: "string", minLength: 1 },
      sha256: SHA256,
      size: { type: "integer", minimum: 1 },
      target: { enum: [...RELEASE_TARGETS] },
    })),
    models: list(record(["id", "source", "repo", "revision", "licence", "commercialUse", "downloadGb", "hardware"], {
      id: { type: "string", minLength: 1 },
      source: { enum: ["huggingface", "ollama"] },
      repo: { type: "string", minLength: 1 },
      revision: { type: "string", minLength: 1 },
      licence: { type: "string", minLength: 1 },
      // Only weights whose licence allows commercial use ship to a client (worker-media models.yaml).
      commercialUse: { const: true },
      downloadGb: { type: "number", exclusiveMinimum: 0 },
      hardware: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["metal", "cuda", "cpu"] } },
    })),
    packs: list(record(["key", "version", "distribution"], {
      key: NAME,
      version: SEMVER,
      distribution: { enum: ["OSS", "COMMERCIAL"] },
    })),
  },
);

function describe(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const where = error.instancePath === "" ? "(root)" : error.instancePath;
    return `${where} ${error.message ?? "is invalid"}`;
  });
}

function duplicates(values: string[], what: string): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const value of values) {
    if (seen.has(value)) problems.push(`${what} '${value}' is listed twice`);
    seen.add(value);
  }
  return problems;
}

/** A path inside the bundle: relative, forward slashes, never climbing out of it. */
export function isBundlePath(file: string): boolean {
  if (file.startsWith("/") || file.includes("\\") || /^[a-zA-Z]:/.test(file)) return false;
  return !file.split("/").some((part) => part === ".." || part === "." || part === "");
}

/** The rules the schema cannot say. Runs on a manifest whose shape is already valid. */
function invariants(m: ReleaseManifest): string[] {
  const problems = [
    ...duplicates(m.components.map((c) => c.name), "component"),
    ...duplicates(m.images.map((i) => i.name), "image"),
    ...duplicates(m.artefacts.map((a) => a.name), "artefact"),
    ...duplicates(m.models.map((x) => x.id), "model"),
    ...duplicates(m.packs.map((p) => p.key), "pack"),
  ];
  const prerelease = parseSemver(m.version)?.prerelease ?? "";
  if (m.channel === "stable" && prerelease !== "") {
    problems.push(`a stable release has no pre-release tag (got ${m.version})`);
  }
  if (m.channel === "candidate" && prerelease === "") {
    problems.push(`a candidate release carries a pre-release tag such as -rc.1 (got ${m.version})`);
  }
  if (compareSemver(m.upgradeFrom, m.version) > 0) {
    problems.push(`upgradeFrom ${m.upgradeFrom} is newer than the release itself (${m.version})`);
  }
  // Containers run on Linux everywhere; on a Mac they run in an arm64 VM, so every image a Mac
  // runs must exist for linux/arm64. The CUDA image only runs on an NVIDIA Linux box.
  const linuxPlatforms = new Set<string>(m.targets.map((t) => (t === "linux-amd64" ? "linux/amd64" : "linux/arm64")));
  for (const image of m.images) {
    const needed = image.gpu === "cuda" ? ["linux/amd64"] : [...linuxPlatforms];
    for (const platform of needed) {
      if (!image.platforms.includes(platform)) {
        problems.push(`image ${image.name} has no ${platform} variant, which target(s) ${m.targets.join(", ")} need`);
      }
    }
  }
  for (const artefact of m.artefacts) {
    if (!m.targets.includes(artefact.target)) {
      problems.push(`artefact ${artefact.name} is for ${artefact.target}, which the release does not target`);
    }
    if (!isBundlePath(artefact.file)) {
      problems.push(`artefact ${artefact.name} has a file path outside the bundle: ${artefact.file}`);
    }
  }
  return problems;
}

/** Every problem of the manifest, shape first; an empty list means it can be trusted as data. */
export function validateReleaseManifest(manifest: unknown): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(releaseManifestSchema);
  if (!validate(manifest)) return describe(validate.errors);
  return invariants(manifest as unknown as ReleaseManifest);
}

/** Reads a manifest file; a file that is not JSON is reported, not thrown. */
export function readReleaseManifest(file: string): { manifest?: unknown; problems: string[] } {
  if (!fs.existsSync(file)) return { problems: [`manifest not found: ${file}`] };
  try {
    return { manifest: JSON.parse(fs.readFileSync(file, "utf-8")) as unknown, problems: [] };
  } catch (e) {
    return { problems: [`manifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

function sha256Of(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let read: number;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Checks the artefacts of an offline bundle directory against a valid manifest: each file is
 * present, has the recorded size and the recorded SHA-256. `target` limits it to one machine's files.
 */
export function verifyArtefacts(manifest: ReleaseManifest, dir: string, target?: ReleaseTarget): string[] {
  const problems: string[] = [];
  for (const artefact of manifest.artefacts) {
    if (target && artefact.target !== target) continue;
    if (!isBundlePath(artefact.file)) continue; // already reported by validateReleaseManifest
    const file = path.join(dir, artefact.file);
    if (!fs.existsSync(file)) {
      problems.push(`${artefact.name}: ${artefact.file} is missing`);
      continue;
    }
    const size = fs.statSync(file).size;
    if (size !== artefact.size) {
      problems.push(`${artefact.name}: ${artefact.file} is ${size} bytes, the manifest says ${artefact.size}`);
      continue;
    }
    if (sha256Of(file) !== artefact.sha256) {
      problems.push(`${artefact.name}: ${artefact.file} does not match its SHA-256`);
    }
  }
  return problems;
}
