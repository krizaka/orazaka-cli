#!/usr/bin/env node
/**
 * What npm users get, tested before it is published: packs @krizaka/orazaka-cli and its `orazaka`
 * alias, installs both tarballs in an empty project outside any Orazaka workspace, and runs the
 * `orazaka` bin from there — the same path `npx orazaka …` and `npx @krizaka/orazaka-cli …` take.
 *
 *   node scripts/pack-smoke.mjs            (npm run test:pack; CI runs it on every pull request)
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = join(ROOT, "alias");
const cli = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const alias = JSON.parse(readFileSync(join(ALIAS, "package.json"), "utf8"));
const isWindows = process.platform === "win32";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "✔" : "✖"} ${label}${ok || !detail ? "" : `\n${detail}`}`);
  if (!ok) failures += 1;
}

function run(cmd, args, cwd, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ORAZAKA_SKIP_VERSION_CHECK: "true", NO_COLOR: "1", FORCE_COLOR: "0", ...extraEnv },
  });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function pack(dir, dest) {
  // Built just before (prepack would print into the JSON this reads).
  const result = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", dest], dir);
  if (result.status !== 0) {
    console.error(result.out);
    process.exit(1);
  }
  const json = JSON.parse(result.out.slice(result.out.indexOf("[")));
  return { file: join(dest, json[0].filename), files: json[0].files.map((f) => f.path) };
}

const work = mkdtempSync(join(tmpdir(), "orazaka-pack-"));
try {
  // ─── The tarballs ─────────────────────────────────────────────────────────
  const build = run("npm", ["run", "build"], ROOT);
  if (build.status !== 0) {
    console.error(build.out);
    process.exit(1);
  }
  const cliPack = pack(ROOT, work);
  const aliasPack = pack(ALIAS, work);

  check(
    "the CLI tarball holds dist, README, LICENSE, NOTICE and package.json only",
    cliPack.files.every((f) => /^(dist\/|README\.md$|LICENSE$|NOTICE$|package\.json$)/.test(f)),
    cliPack.files.filter((f) => !/^(dist\/|README\.md$|LICENSE$|NOTICE$|package\.json$)/.test(f)).join("\n"),
  );
  check("the CLI tarball ships no test", !cliPack.files.some((f) => f.includes("__tests__")));
  check("the CLI tarball has its bin", cliPack.files.includes(cli.bin.orazaka));
  check(
    `the alias depends on exactly @krizaka/orazaka-cli@${cli.version}`,
    alias.dependencies?.["@krizaka/orazaka-cli"] === cli.version,
    `alias: ${alias.dependencies?.["@krizaka/orazaka-cli"]}`,
  );
  check(`the alias has the CLI's version (${cli.version})`, alias.version === cli.version, `alias: ${alias.version}`);

  // ─── An empty project, outside any workspace ──────────────────────────────
  const project = join(work, "project");
  mkdirSync(project);
  // The alias asks for @krizaka/orazaka-cli from the registry; the override hands it the tarball under test.
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ private: true, overrides: { "@krizaka/orazaka-cli": `file:${cliPack.file}` } }, null, 2),
  );
  // Only the alias is installed — exactly what `npx orazaka` does — and it pulls the CLI in.
  const install = run("npm", ["install", "--no-audit", "--no-fund", aliasPack.file], project);
  check("the alias installs in an empty project and brings the CLI", install.status === 0, install.out);

  const bin = join(project, "node_modules", ".bin", isWindows ? "orazaka.cmd" : "orazaka");
  const aliasBin = join(project, "node_modules", "orazaka", alias.bin.orazaka);
  const elsewhere = join(work, "elsewhere");
  mkdirSync(elsewhere);

  const version = run(bin, ["--version"], elsewhere);
  check(`orazaka --version prints ${cli.version}`, version.status === 0 && version.out.trim() === cli.version, version.out);

  const cliBin = join(project, "node_modules", "@krizaka", "orazaka-cli", cli.bin.orazaka);
  const canonical = run(process.execPath, [cliBin, "--version"], elsewhere);
  check("@krizaka/orazaka-cli's own bin runs", canonical.status === 0 && canonical.out.trim() === cli.version, canonical.out);

  const viaAlias = run(process.execPath, [aliasBin, "--version"], elsewhere);
  check("the alias runs the same CLI", viaAlias.status === 0 && viaAlias.out.trim() === cli.version, viaAlias.out);

  const aliasExit = run(process.execPath, [aliasBin, "no-such-command"], elsewhere);
  check("the alias relays the CLI's exit code", aliasExit.status !== 0, aliasExit.out);

  const help = run(bin, ["--help"], elsewhere);
  check(
    "orazaka --help lists install, start and dev",
    help.status === 0 && ["install", "start", "dev", "demo"].every((c) => help.out.includes(`\n  ${c}`)),
    help.out,
  );

  const seedHelp = run(bin, ["demo", "seed", "--help"], elsewhere);
  check("orazaka demo seed --help", seedHelp.status === 0 && seedHelp.out.includes("--fresh"), seedHelp.out);

  const checkOnly = run(bin, ["install", "--check-only"], elsewhere);
  check("orazaka install --check-only reports the tools", checkOnly.status === 0 && checkOnly.out.includes("Tool"), checkOnly.out);

  for (const command of ["start", "dev"]) {
    const outside = run(bin, [command], elsewhere);
    check(
      `orazaka ${command} outside a workspace explains how to get one`,
      outside.status === 1 && outside.out.includes("Orazaka workspace") && outside.out.includes("npx orazaka install"),
      outside.out,
    );
  }

  const noTty = run(bin, ["install"], elsewhere);
  check(
    "orazaka install without a terminal and without --yes clones nothing",
    noTty.status === 1 && noTty.out.includes("--yes") && readdirSync(elsewhere).length === 0,
    `${noTty.out}\n${readdirSync(elsewhere).join(", ")}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nThe packed CLI and its alias work from npm.");
