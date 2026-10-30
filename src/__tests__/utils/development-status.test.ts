/**
 * @file development-status.test.ts
 * @description orazaka-cli#109: the CLI says « in development » (EN/FR), never « ready ».
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { developmentStatus, resolveLocale, DEVELOPMENT_STATUS } from "../../utils/development-status";

describe("development status line", () => {
  it("is English by default and by LANG=en_US", () => {
    expect(resolveLocale({})).toBe("en");
    expect(developmentStatus({ LANG: "en_US.UTF-8" })).toMatch(/^In development/);
  });

  it("is French for a French locale, ORAZAKA_LANG winning", () => {
    expect(developmentStatus({ LANG: "fr_CA.UTF-8" })).toMatch(/^En développement/);
    expect(developmentStatus({ LANG: "fr_CA.UTF-8", ORAZAKA_LANG: "en" })).toMatch(/^In development/);
    expect(developmentStatus({ LC_ALL: "fr_FR", LANG: "en_US" })).toMatch(/^En développement/);
  });

  it("never says ready, stable or production in either language", () => {
    for (const line of Object.values(DEVELOPMENT_STATUS)) {
      expect(line).not.toMatch(/ready|stable|production|prêt|disponible/i);
    }
  });

  it("is printed by login, status and the --help footer", () => {
    const src = (f: string): string => fs.readFileSync(path.join(__dirname, "../../", f), "utf8");
    expect(src("commands/login.command.ts")).toContain("developmentStatus()");
    expect(src("commands/status.command.ts")).toContain("developmentStatus()");
    expect(src("index.ts")).toContain("developmentStatus()");
  });
});
