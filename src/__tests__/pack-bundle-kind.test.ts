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

const BLUEPRINT = {
  version: "1.0.0",
  status: "PUBLISHED",
  definition: { studioKey: "image-generation", version: "1.0.0", steps: [], outputs: [] },
  inputSchema: { type: "object" },
};

function bundleDir(manifest: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-pack-"));
  fs.mkdirSync(path.join(dir, "studios", "image-generation"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "studios", "image-generation", "blueprint.json"),
    JSON.stringify(BLUEPRINT),
    "utf-8",
  );
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
  categoryKey: business
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
