/**
 * @file dev-module-paths.test.ts
 * @description The Maven modules `orazaka dev` runs from krizaka-build are paths of the workspace reactor: the
 * workspace pom lists `krizaka/krizaka-build` only (users, billing and the platform kit joined it, ADR-021), so a
 * `-pl krizaka/krizaka-users/…` is not a module and the service never starts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { KRIZAKA_BUILD_MODULES } from "../commands/dev.command";

describe("the krizaka-build modules of `orazaka dev`", () => {
  test("each one is under krizaka/krizaka-build", () => {
    for (const module of Object.values(KRIZAKA_BUILD_MODULES)) {
      expect(module.startsWith("krizaka/krizaka-build/")).toBe(true);
    }
  });

  test("no -pl names a split repository folder", () => {
    const source = readFileSync(path.join(__dirname, "../commands/dev.command.ts"), "utf8");
    expect(source).not.toMatch(/"krizaka\/krizaka-(users|billing|platform-kit)\//);
  });
});
