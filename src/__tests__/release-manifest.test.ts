/**
 * @file release-manifest.test.ts
 * @description The release manifest (docs/DELIVERY.md §5): one version for the bundle, everything pinned —
 * images by digest, artefacts by SHA-256, models by revision and with a commercial licence — and an
 * offline bundle verified file by file before anything is installed.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isBundlePath,
  readReleaseManifest,
  validateReleaseManifest,
  verifyArtefacts,
  type ReleaseManifest,
} from "../services/release-manifest";
import { compareSemver, parseSemver } from "../services/semver";

const SHA = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const DIGEST = `sha256:${"a".repeat(64)}`;

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    schema: "orazaka.dev/release/v1",
    version: "1.0.0",
    channel: "stable",
    releasedAt: "2026-11-02T12:00:00Z",
    upgradeFrom: "1.0.0",
    cli: { package: "@krizaka/orazaka-cli", version: "1.2.0" },
    targets: ["mac-arm64", "linux-amd64"],
    components: [
      { name: "orazaka-studio", repository: "krizaka/orazaka-studio", version: "1.0.0", commit: "b".repeat(40) },
    ],
    images: [
      {
        name: "orazaka-platform",
        ref: "ghcr.io/krizaka/orazaka-platform",
        digest: DIGEST,
        platforms: ["linux/amd64", "linux/arm64"],
      },
      {
        name: "orazaka-worker-media-cuda",
        ref: "ghcr.io/krizaka/orazaka-worker-media",
        digest: DIGEST,
        platforms: ["linux/amd64"],
        gpu: "cuda",
      },
    ],
    artefacts: [{ name: "sd-server", file: "mac-arm64/sd-server", sha256: SHA("sd"), size: 2, target: "mac-arm64" }],
    models: [
      {
        id: "wan2.2-ti2v-5b",
        source: "huggingface",
        repo: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
        revision: "b8fff7315c768468a5333511427288870b2e9635",
        licence: "Apache-2.0",
        commercialUse: true,
        downloadGb: 34.2,
        hardware: ["cuda"],
      },
    ],
    packs: [{ key: "document-validation", version: "1.0.0", distribution: "OSS" }],
    ...overrides,
  };
}

describe("validateReleaseManifest", () => {
  it("accepts a complete, pinned manifest", () => {
    expect(validateReleaseManifest(manifest())).toEqual([]);
  });

  it("refuses an image pinned by tag instead of digest", () => {
    const m = manifest();
    m.images[0] = { ...m.images[0], digest: "latest" };
    expect(validateReleaseManifest(m).join("\n")).toMatch(/images\/0\/digest/);
  });

  it("refuses a model whose licence does not allow commercial use", () => {
    const m = manifest() as unknown as { models: Record<string, unknown>[] };
    m.models[0].commercialUse = false;
    expect(validateReleaseManifest(m).join("\n")).toMatch(/models\/0\/commercialUse/);
  });

  it("refuses a missing field and an unknown one", () => {
    const { packs: _packs, ...rest } = manifest();
    expect(validateReleaseManifest(rest).join("\n")).toMatch(/packs/);
    expect(validateReleaseManifest({ ...manifest(), telemetry: true }).join("\n")).toMatch(/additional properties/);
  });

  it("keeps the channel and the version honest", () => {
    expect(validateReleaseManifest(manifest({ version: "1.1.0-rc.1" }))).toContain(
      "a stable release has no pre-release tag (got 1.1.0-rc.1)",
    );
    expect(validateReleaseManifest(manifest({ channel: "candidate" })).join("\n")).toMatch(
      /pre-release tag such as -rc.1/,
    );
    expect(validateReleaseManifest(manifest({ channel: "candidate", version: "1.1.0-rc.1" }))).toEqual([]);
  });

  it("refuses an upgrade path from a newer version", () => {
    expect(validateReleaseManifest(manifest({ upgradeFrom: "2.0.0" })).join("\n")).toMatch(
      /upgradeFrom 2.0.0 is newer/,
    );
  });

  it("needs an arm64 variant of every image a Mac runs, but not of the CUDA image", () => {
    const m = manifest();
    m.images[0] = { ...m.images[0], platforms: ["linux/amd64"] };
    const problems = validateReleaseManifest(m);
    expect(problems).toEqual([expect.stringMatching(/orazaka-platform has no linux\/arm64 variant/)]);
  });

  it("refuses duplicates, foreign targets and paths that leave the bundle", () => {
    const m = manifest();
    m.packs.push({ ...m.packs[0] });
    m.artefacts.push({ name: "worker", file: "../etc/passwd", sha256: SHA("x"), size: 1, target: "linux-arm64" });
    const problems = validateReleaseManifest(m).join("\n");
    expect(problems).toMatch(/pack 'document-validation' is listed twice/);
    expect(problems).toMatch(/artefact worker is for linux-arm64, which the release does not target/);
    expect(problems).toMatch(/outside the bundle: \.\.\/etc\/passwd/);
  });
});

describe("isBundlePath", () => {
  it.each([
    ["mac-arm64/sd-server", true],
    ["a/b/c.tar.zst", true],
    ["/abs", false],
    ["a/../b", false],
    ["./a", false],
    ["a//b", false],
    ["C:/x", false],
    ["a\\b", false],
  ])("%s → %s", (file, ok) => {
    expect(isBundlePath(file)).toBe(ok);
  });
});

describe("verifyArtefacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-release-"));
  fs.mkdirSync(path.join(dir, "mac-arm64"));

  it("passes when every file has its size and SHA-256", () => {
    fs.writeFileSync(path.join(dir, "mac-arm64", "sd-server"), "sd");
    expect(verifyArtefacts(manifest(), dir)).toEqual([]);
  });

  it("reports a tampered, a truncated and a missing file", () => {
    fs.writeFileSync(path.join(dir, "mac-arm64", "sd-server"), "xx");
    expect(verifyArtefacts(manifest(), dir)).toEqual(["sd-server: mac-arm64/sd-server does not match its SHA-256"]);
    fs.writeFileSync(path.join(dir, "mac-arm64", "sd-server"), "s");
    expect(verifyArtefacts(manifest(), dir)).toEqual([
      "sd-server: mac-arm64/sd-server is 1 bytes, the manifest says 2",
    ]);
    fs.rmSync(path.join(dir, "mac-arm64", "sd-server"));
    expect(verifyArtefacts(manifest(), dir)).toEqual(["sd-server: mac-arm64/sd-server is missing"]);
  });

  it("checks only one target's files when asked", () => {
    expect(verifyArtefacts(manifest(), dir, "linux-amd64")).toEqual([]);
  });
});

describe("readReleaseManifest", () => {
  it("reports a missing file and a file that is not JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-release-"));
    expect(readReleaseManifest(path.join(dir, "nope.json")).problems[0]).toMatch(/manifest not found/);
    fs.writeFileSync(path.join(dir, "bad.json"), "{");
    expect(readReleaseManifest(path.join(dir, "bad.json")).problems[0]).toMatch(/not valid JSON/);
    fs.writeFileSync(path.join(dir, "ok.json"), JSON.stringify(manifest()));
    expect(readReleaseManifest(path.join(dir, "ok.json")).problems).toEqual([]);
  });
});

describe("semver", () => {
  it("orders versions as SemVer 2.0.0 says", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.10.0",
      "2.0.0",
    ];
    for (let i = 1; i < ordered.length; i += 1) {
      expect(compareSemver(ordered[i - 1], ordered[i])).toBe(-1);
      expect(compareSemver(ordered[i], ordered[i - 1])).toBe(1);
    }
    expect(compareSemver("1.0.0+build.1", "1.0.0")).toBe(0);
  });

  it("parses releases and pre-releases, refuses the rest", () => {
    expect(parseSemver("1.2.3-rc.1")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: "rc.1" });
    expect(parseSemver("01.2.3")).toBeUndefined();
    expect(() => compareSemver("1.2", "1.2.0")).toThrow(/not a semantic version: 1.2/);
  });
});
