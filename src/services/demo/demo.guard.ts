/**
 * @file demo.guard.ts
 * @description The demo persona exists on a developer's machine and nowhere else.
 *
 * A demo account has a known password. On a shared environment it is a door, so the seeder refuses
 * to run unless both facts hold, and says which one failed:
 *  - the target is this machine (loopback host), and
 *  - no environment variable declares a deployed profile (production, staging, prod, preprod).
 * There is no flag to bypass it: a demo on a hosted environment is a separate, deliberate change.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Environment variables that name the profile a stack runs under. */
const PROFILE_VARIABLES = ["ORAZAKA_ENV", "APP_ENV", "SPRING_PROFILES_ACTIVE", "NODE_ENV"] as const;

const DEPLOYED_PROFILE = /\b(prod|production|preprod|staging)\b/i;

export class DemoGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoGuardError";
  }
}

/**
 * Throws a {@link DemoGuardError} unless the seed targets a local, non-deployed stack.
 *
 * @param baseUrl the platform URL the seed would write to (ROUTER_URL, the edge)
 * @param env the environment to read the profile from (process.env in the command)
 */
export function assertLocalDemoTarget(baseUrl: string, env: Readonly<Record<string, string | undefined>>): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new DemoGuardError(`Not a URL: "${baseUrl}". Set ROUTER_URL to the local edge (http://localhost:8088).`);
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DemoGuardError(
      `Refusing to seed the demo persona on "${host}": the demo account has a known password and only ever exists on this machine.`,
    );
  }
  for (const name of PROFILE_VARIABLES) {
    const value = env[name];
    if (value && DEPLOYED_PROFILE.test(value)) {
      throw new DemoGuardError(`Refusing to seed the demo persona: ${name}=${value} declares a deployed profile.`);
    }
  }
}
