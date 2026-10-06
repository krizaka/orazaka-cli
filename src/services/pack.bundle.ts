/**
 * @file pack.bundle.ts
 * @description Reads a pack bundle directory into the single value the installer applies (ADR-037 §3.2).
 *
 * A bundle on disk is a manifest plus the files it names; a bundle on the wire is one object.
 * Resolving the two apart matters: an install that had to reach back to the filesystem could
 * fail after writing half a catalogue, so every file is read and every reference resolved
 * BEFORE anything is sent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

/** One locale's strings for a pack, its shelf, or one of its Studios. */
export interface LocalisedText {
  readonly label: string;
  readonly tagline?: string | null;
  readonly description?: string | null;
}

/** A blueprint version, read from the file the manifest names. */
export interface PackBlueprint {
  readonly version: string;
  readonly status: string;
  readonly definition: string;
  readonly inputSchema: string;
  readonly configSchema: string;
  readonly estimatedCredits: number;
  readonly changelog?: string | null;
  readonly createdBy: string;
}

/** One Studio the bundle ships, with its blueprint inlined. */
export interface PackStudio {
  readonly key: string;
  readonly profession: string;
  readonly iconKey: string;
  readonly pricing: string;
  readonly entitlementKey: string;
  readonly status: string;
  readonly publisherId: string;
  readonly sortWeight: number;
  readonly blueprint: PackBlueprint;
}

/** The resolved bundle: exactly the shape the install endpoint accepts. */
export interface PackBundle {
  readonly apiVersion: string;
  readonly key: string;
  readonly version: string;
  readonly tier: string;
  readonly distribution: string;
  readonly regulatoryClass: string;
  /**
   * VERTICAL or TOOLKIT — how the pack reaches the user (ADR-061). Carried like its two sibling
   * classifications; dropping it here would install every TOOLKIT as a VERTICAL with nothing to say so.
   */
  readonly kind: string;
  readonly capabilities: readonly unknown[];
  /** The domain the pack refuses; required by the platform for a SENSITIVE pack. */
  readonly scopeGuard: unknown | null;
  /** REGULATED only: the versioned consent that blocks installation (ADR-055). */
  readonly consent: unknown | null;
  /** REGULATED only: the crisis terms, the reviewed response, and the sourced resources. */
  readonly safety: unknown | null;
  readonly catalog: unknown | null;
  readonly pricing: unknown | null;
  readonly studios: readonly PackStudio[];
  readonly translations: Record<string, unknown>;
}

/** A structural problem with the manifest, phrased for a terminal rather than a stack trace. */
export class BundleError extends Error {}

const MANIFEST = "pack.yaml";
const I18N_DIR = "i18n";

/** Where the platform keeps the manifest contract it enforces. */
const PACKS_DIR = "orazaka-packs";
const SCHEMA_FILE = "pack.schema.json";

/**
 * The PLATFORM's manifest schema — never the bundle's.
 *
 * <p>This used to walk up from the bundle directory, and its own error message said what was
 * wrong with that: "a bundle is validated against the schema of the platform installing it".
 * Walking up from the bundle finds the schema of whatever tree the bundle happens to sit in — for
 * a pack outside this repository, that is either nothing at all (phase G's acceptance criterion
 * failed here first) or a schema the pack author shipped themselves, which would let a bundle
 * validate against its own claim about what a manifest is.
 *
 * <p>Resolved from this CLI's own location instead: the tool doing the installing carries the
 * contract it enforces. In the local phase the CLI runs from the repository, so the walk finds
 * `orazaka-packs/pack.schema.json`; publishing the CLI as a package would mean copying the schema
 * into it at build time, which is a packaging change and not this phase's.
 */
function locateSchema(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, PACKS_DIR, SCHEMA_FILE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new BundleError(
    `This CLI cannot find its own ${PACKS_DIR}/${SCHEMA_FILE}. A bundle is validated against the ` +
      "schema of the platform installing it, so a platform that cannot produce its schema must " +
      "refuse rather than trust the bundle's.",
  );
}

/** Turns ajv's error objects into lines an operator can act on. */
function describe(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const where = error.instancePath === "" ? "(root)" : error.instancePath;
    return `${where} ${error.message ?? "is invalid"}`;
  });
}

/** Validates the manifest's SHAPE against pack.schema.json. Semantics are the service's half. */
export function validateManifest(bundleDir: string, manifest: unknown): string[] {
  const schema = JSON.parse(fs.readFileSync(locateSchema(), "utf-8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return validate(manifest) ? [] : describe(validate.errors);
}

/** Reads one blueprint file, keeping its three schemas as the raw JSON the table stores. */
function readBlueprint(bundleDir: string, relativePath: string): PackBlueprint {
  const file = path.join(bundleDir, relativePath);
  if (!fs.existsSync(file)) {
    throw new BundleError(`Blueprint not found: ${relativePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  for (const required of ["version", "definition", "inputSchema"]) {
    if (raw[required] === undefined) {
      throw new BundleError(`${relativePath} declares no ${required}`);
    }
  }
  return {
    version: String(raw.version),
    status: String(raw.status ?? "DRAFT"),
    // Re-serialised, not passed through: the table's columns are jsonb and the service sends
    // them as text. Stringifying here keeps the CLI from inventing a second JSON dialect.
    definition: JSON.stringify(raw.definition),
    inputSchema: JSON.stringify(raw.inputSchema),
    configSchema: JSON.stringify(raw.configSchema ?? {}),
    estimatedCredits: Number(raw.estimatedCredits ?? 0),
    changelog: (raw.changelog as string | undefined) ?? null,
    createdBy: String(raw.createdBy ?? "system"),
  };
}

/** Reads every i18n/<locale>.yaml into the translation map the bundle carries. */
function readTranslations(bundleDir: string): Record<string, unknown> {
  const dir = path.join(bundleDir, I18N_DIR);
  if (!fs.existsSync(dir)) {
    return {};
  }
  const translations: Record<string, unknown> = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
      continue;
    }
    const locale = file.replace(/\.ya?ml$/, "");
    translations[locale] = parseYaml(fs.readFileSync(path.join(dir, file), "utf-8")) ?? {};
  }
  return translations;
}

/**
 * The capabilities a pack contributes, with their contract re-serialised.
 *
 * `inputSchema` and `outputSchema` are objects in the manifest and `jsonb` in the table, and the
 * record between them carries them as text — the same resolution the three blueprint schemas
 * already get above, and for the same reason: stringifying here keeps the CLI from inventing a
 * second JSON dialect (ADR-069).
 */
function readCapabilities(declared: unknown): readonly unknown[] {
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared.map((entry) => {
    const capability = entry as Record<string, unknown>;
    return {
      ...capability,
      inputSchema: JSON.stringify(capability.inputSchema ?? {}),
      outputSchema: JSON.stringify(capability.outputSchema ?? {}),
    };
  });
}

/**
 * Reads a bundle directory into the value the installer applies.
 *
 * @param bundleDir the directory holding pack.yaml
 * @returns the resolved bundle, and the shape problems found in its manifest
 */
export function loadBundle(bundleDir: string): { bundle: PackBundle; problems: string[] } {
  const resolved = path.resolve(bundleDir);
  const manifestPath = path.join(resolved, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    throw new BundleError(`No ${MANIFEST} in ${resolved} — that file is what makes a directory a pack.`);
  }
  const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  const problems = validateManifest(resolved, manifest);
  if (problems.length > 0) {
    // Returned rather than thrown: `validate` must be able to print every problem at once, and a
    // bundle with four faults should cost one run to diagnose rather than four.
    return { bundle: manifest as unknown as PackBundle, problems };
  }

  const requires = (manifest.requires ?? {}) as Record<string, unknown>;
  const studios = (manifest.studios as Record<string, unknown>[]).map((studio) => ({
    key: String(studio.key),
    profession: String(studio.profession),
    iconKey: String(studio.iconKey),
    pricing: String(studio.pricing),
    entitlementKey: String(studio.entitlementKey),
    status: String(studio.status ?? "DRAFT"),
    publisherId: String(studio.publisherId ?? "orazaka"),
    sortWeight: Number(studio.sortWeight ?? 0),
    blueprint: readBlueprint(resolved, String(studio.blueprint)),
  }));

  return {
    bundle: {
      apiVersion: String(manifest.apiVersion),
      key: String(manifest.key),
      version: String(manifest.version),
      tier: String(manifest.tier ?? "DATA"),
      distribution: String(manifest.distribution ?? "OSS"),
      regulatoryClass: String(manifest.regulatoryClass ?? "STANDARD"),
      // The schema's declared default, like tier and regulatoryClass above. VERTICAL is also the
      // kind that grants nothing by itself, so an omitted kind can never hand out a capability.
      kind: String(manifest.kind ?? "VERTICAL"),
      capabilities: readCapabilities(requires.capabilities),
      catalog: manifest.catalog ?? null,
      pricing: manifest.pricing ?? null,
      studios,
      translations: readTranslations(resolved),
      // Passed through, never defaulted: the platform refuses a SENSITIVE bundle that declares
      // no scope guard, and a CLI inventing an empty one would turn that refusal into a pack
      // that installs with a control nobody wrote (ADR-051).
      scopeGuard: manifest.scopeGuard ?? null,
      consent: manifest.consent ?? null,
      safety: manifest.safety ?? null,
    },
    problems: [],
  };
}
