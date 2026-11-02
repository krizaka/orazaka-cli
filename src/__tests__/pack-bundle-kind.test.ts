/**
 * @file pack-bundle-kind.test.ts
 * @description ADR-061 — the CLI carries a manifest's `kind` to the installer, and refuses the
 * combinations a TOOLKIT cannot take before anything reaches the network.
 *
 * The CLI copies a manifest field by field into the bundle it posts. A field it forgets is not an
 * error anywhere: the server defaults it, and a TOOLKIT would install as a VERTICAL in silence —
 * the declared-and-bound-to-nothing shape the M0.5 inventory is about.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadBundle } from "../services/pack.bundle";

/**
 * The slice of the platform's `orazaka-packs/pack.schema.json` these tests exercise (kind, the two
 * TOOLKIT rules, the catalog-needs-pricing rule). The CLI validates against the schema of the platform
 * it installs into, found by walking up from its own location or from the current directory; a clone
 * outside the workspace has neither, so the tests stand a small workspace up around the current
 * directory instead of depending on a sibling checkout. Inside the workspace the real schema wins.
 */
const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["apiVersion", "key", "version", "studios"],
  properties: {
    apiVersion: { const: "orazaka.dev/v1" },
    key: { type: "string" },
    version: { type: "string" },
    regulatoryClass: { enum: ["STANDARD", "SENSITIVE", "REGULATED"] },
    kind: { enum: ["VERTICAL", "TOOLKIT"] },
    studios: { type: "array", minItems: 1 },
  },
  allOf: [
    { if: { required: ["catalog"] }, then: { required: ["pricing"] } },
    {
      if: { properties: { kind: { const: "TOOLKIT" } }, required: ["kind"] },
      then: { properties: { regulatoryClass: { not: { const: "REGULATED" } } }, required: ["catalog"] },
    },
  ],
};

let workspace: string;
let cwd: jest.SpyInstance;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-workspace-"));
  fs.writeFileSync(path.join(workspace, "orazaka.workspace.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(workspace, "orazaka-packs"));
  fs.writeFileSync(path.join(workspace, "orazaka-packs", "pack.schema.json"), JSON.stringify(SCHEMA), "utf-8");
  cwd = jest.spyOn(process, "cwd").mockReturnValue(workspace);
});

afterAll(() => {
  cwd.mockRestore();
  fs.rmSync(workspace, { recursive: true, force: true });
});

const BLUEPRINT = {
  version: "1.0.0",
  status: "PUBLISHED",
  definition: { studioKey: "image-generation", version: "1.0.0", steps: [], outputs: [] },
  inputSchema: { type: "object" },
};

function bundleDir(manifest: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-pack-"));
  fs.mkdirSync(path.join(dir, "studios", "image-generation"), { recursive: true });
  fs.writeFileSync(path.join(dir, "studios", "image-generation", "blueprint.json"), JSON.stringify(BLUEPRINT), "utf-8");
  fs.writeFileSync(path.join(dir, "pack.yaml"), manifest, "utf-8");
  return dir;
}

const HEADER = `apiVersion: orazaka.dev/v1
key: media-toolkit
version: 1.0.0
`;

const STUDIOS = `studios:
  - key: image-generation
    profession: media
    iconKey: image
    pricing: INCLUDED
    entitlementKey: studio.image-generation
    blueprint: studios/image-generation/blueprint.json
`;

const CATALOG = `catalog:
  categoryKey: business-compliance
  iconKey: image
pricing:
  priceCents: 0
  includedCredits: 0
`;

describe("pack.bundle — kind (ADR-061)", () => {
  it("carries a declared TOOLKIT to the installer instead of dropping it", () => {
    const { bundle, problems } = loadBundle(bundleDir(`${HEADER}kind: TOOLKIT\n${CATALOG}${STUDIOS}`));

    expect(problems).toEqual([]);
    expect(bundle.kind).toBe("TOOLKIT");
  });

  it("reads an omitted kind as VERTICAL, the kind that grants nothing by itself", () => {
    const { bundle, problems } = loadBundle(bundleDir(`${HEADER}${STUDIOS}`));

    expect(problems).toEqual([]);
    expect(bundle.kind).toBe("VERTICAL");
  });

  it("refuses a REGULATED TOOLKIT before it reaches the network — and only because it is a TOOLKIT", () => {
    const regulated = `regulatoryClass: REGULATED\n${CATALOG}${STUDIOS}`;

    // The control: the same manifest as a VERTICAL raises nothing about its class, so a problem
    // below cannot be one this manifest had for another reason.
    expect(loadBundle(bundleDir(`${HEADER}${regulated}`)).problems).toEqual([]);

    const { problems } = loadBundle(bundleDir(`${HEADER}kind: TOOLKIT\n${regulated}`));
    expect(problems).toContainEqual(expect.stringContaining("/regulatoryClass"));
  });

  it("refuses a TOOLKIT with no catalog entry, whose kind would have no row to live on", () => {
    expect(loadBundle(bundleDir(`${HEADER}${STUDIOS}`)).problems).toEqual([]);

    const { problems } = loadBundle(bundleDir(`${HEADER}kind: TOOLKIT\n${STUDIOS}`));
    expect(problems).toContainEqual(expect.stringContaining("catalog"));
  });
});
