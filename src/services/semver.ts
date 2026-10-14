/**
 * @file semver.ts
 * @description The few Semantic Versioning 2.0.0 rules the release manifest needs: parse and compare.
 * Build metadata (`+…`) is accepted and ignored by the comparison, as the specification says.
 */

export const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$";

const SEMVER = new RegExp(SEMVER_PATTERN);

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** "" for a release, e.g. "rc.1" for a pre-release. */
  prerelease: string;
}

export function parseSemver(version: string): Semver | undefined {
  const match = SEMVER.exec(version);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? "" };
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1; // numeric identifiers sort before alphanumeric ones
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1, 0 or 1. Throws on a version that is not SemVer: callers validate first. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`not a semantic version: ${!x ? a : b}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return Math.sign(x[key] - y[key]);
  }
  if (x.prerelease === y.prerelease) return 0;
  if (x.prerelease === "") return 1; // 1.0.0 > 1.0.0-rc.1
  if (y.prerelease === "") return -1;
  const xs = x.prerelease.split(".");
  const ys = y.prerelease.split(".");
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const order = compareIdentifiers(xs[i], ys[i]);
    if (order !== 0) return order;
  }
  return Math.sign(xs.length - ys.length);
}
