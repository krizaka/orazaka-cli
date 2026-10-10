/**
 * @file demo-seed.test.ts
 * @description The demo persona: the guard that keeps it on a developer's machine, and a seed that
 * goes through the public API and gives the same state when it runs twice.
 */

import { assertLocalDemoTarget, DemoGuardError } from "../services/demo/demo.guard";
import { actorIdOf, DemoSeeder, verificationTokenIn, type Fetch } from "../services/demo/demo.seed";
import { DEMO_CREDITS, DEMO_PERSONA, DEMO_STUDIOS } from "../services/demo/demo.persona";

const ACTOR = "1c10ee07-1b3a-4140-923e-4923f959f8c7";
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("assertLocalDemoTarget", () => {
  test("accepts the local edge", () => {
    expect(() => assertLocalDemoTarget("http://localhost:8088", {})).not.toThrow();
    expect(() => assertLocalDemoTarget("http://127.0.0.1:8088", { NODE_ENV: "development" })).not.toThrow();
  });

  test("refuses any host that is not this machine", () => {
    expect(() => assertLocalDemoTarget("https://app.orazaka.com", {})).toThrow(DemoGuardError);
    expect(() => assertLocalDemoTarget("http://10.0.0.5:8088", {})).toThrow(/only ever exists on this machine/);
  });

  test("refuses a deployed profile even on localhost", () => {
    expect(() => assertLocalDemoTarget("http://localhost:8088", { SPRING_PROFILES_ACTIVE: "prod" })).toThrow(/SPRING_PROFILES_ACTIVE/);
    expect(() => assertLocalDemoTarget("http://localhost:8088", { ORAZAKA_ENV: "staging" })).toThrow(DemoGuardError);
  });

  test("refuses what is not a URL", () => {
    expect(() => assertLocalDemoTarget("localhost", {})).toThrow(/Not a URL/);
  });
});

describe("token helpers", () => {
  test("reads the actor id from the session token", () => {
    expect(actorIdOf(jwt(ACTOR))).toBe(ACTOR);
    expect(() => actorIdOf("not-a-jwt")).toThrow();
  });

  test("finds the verification token in the e-mail", () => {
    expect(verificationTokenIn("Confirm: http://localhost:3000/verify?token=abc-123_X.")).toBe("abc-123_X.");
    expect(verificationTokenIn("nothing here")).toBeNull();
  });
});

/** A tiny in-memory platform: enough of each service for the seed to talk to. */
function platform() {
  const state = { registered: false, verified: false, plan: "", balance: 0, packs: new Set<string>(), studios: new Set<string>(), calls: [] as string[] };
  const fetch: Fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push(`${method} ${path}`);
    if (path.startsWith("/api/v1/search")) return json(200, { messages: state.registered ? [{ ID: "m1" }] : [] });
    if (path === "/api/v1/message/m1") return json(200, { Text: "http://localhost:3000/verify?token=tok-1" });
    switch (`${method} ${path.split("?")[0]}`) {
      case "POST /api/v1/auth/register":
        if (state.registered) return json(409, { error: "exists" });
        state.registered = true;
        return json(201, { requires_verification: true });
      case "POST /api/v1/auth/verify":
        state.verified = body.token === "tok-1";
        return json(state.verified ? 200 : 400);
      case "POST /api/v1/auth/login":
        if (body.email === "admin@orazaka.com") return json(200, { token: jwt("admin") });
        if (!state.verified) return json(401);
        return json(200, { token: jwt(ACTOR), activeInterceptions: ["onboarding"] });
      case "POST /api/v1/interceptions/resolve":
      case "PUT /api/v1/profile/preferences":
        return json(200, {});
      case `GET /api/v1/billing/subscriptions/${ACTOR}`:
        return state.plan ? json(200, { planKey: state.plan, status: "ACTIVE" }) : json(404);
      case `POST /api/v1/billing/subscriptions/${ACTOR}`:
        state.plan = body.planKey;
        return json(200, {});
      case `GET /api/v1/billing/wallets/${ACTOR}`:
        return state.balance ? json(200, { balanceGranted: state.balance, balancePurchased: 0, held: 0 }) : json(404);
      case `POST /api/v1/billing/wallets/${ACTOR}/adjustments`:
        state.balance += body.amount;
        return json(200, {});
      case "GET /api/v1/studios/installations":
        return json(200, [...state.studios].map((studioKey) => ({ studioKey })));
    }
    const pack = /^\/api\/v1\/billing\/pack-subscriptions\/me\/(.+)$/.exec(path);
    if (pack) return state.packs.has(pack[1]) ? json(409) : (state.packs.add(pack[1]), json(201, {}));
    const studio = /^\/api\/v1\/studios\/([^/]+)\/installations/.exec(path);
    if (studio) {
      if (studio[1] === "image-generation") return json(409, { status: "studio_included" });
      state.studios.add(studio[1]);
      return json(201, {});
    }
    return json(500, { unexpected: `${method} ${path}` });
  };
  return { state, fetch };
}

function seeder(fetch: Fetch, steps: string[] = []) {
  return new DemoSeeder({
    baseUrl: "http://localhost:8088",
    mailUrl: "http://localhost:8025",
    password: "secret-demo",
    admin: { email: "admin@orazaka.com", password: "x" },
    env: {},
    fetch,
    onStep: (line) => steps.push(line),
    mailTimeoutMs: 0,
  });
}

describe("DemoSeeder", () => {
  test("creates Eric through the public API: verified, onboarded, on the plan, credited, equipped", async () => {
    const { state, fetch } = platform();
    const result = await seeder(fetch).run();

    expect(result).toMatchObject({ actorId: ACTOR, email: DEMO_PERSONA.email, plan: "premium", credits: DEMO_CREDITS });
    expect(state).toMatchObject({ registered: true, verified: true, plan: "premium", balance: DEMO_CREDITS });
    expect([...state.packs]).toEqual(["orazaka-media", "outbound-prospection"]);
    expect([...state.studios]).toEqual(DEMO_STUDIOS.filter((k) => k !== "image-generation"));
    expect(state.calls).toContain("POST /api/v1/interceptions/resolve");
  });

  test("is replayable: a second run changes nothing and grants no extra credit", async () => {
    const { state, fetch } = platform();
    await seeder(fetch).run();
    const steps: string[] = [];
    await seeder(fetch, steps).run();

    expect(state.balance).toBe(DEMO_CREDITS);
    expect(steps).toContain(`Account already exists: ${DEMO_PERSONA.email}`);
    expect(steps).toContain("Plan already premium");
    expect(steps).toContain(`Credits already at ${DEMO_CREDITS}`);
  });

  test("never calls the platform when the target is not local", async () => {
    const { state, fetch } = platform();
    const remote = new DemoSeeder({ baseUrl: "https://orazaka.example", mailUrl: "", password: "p", admin: { email: "a", password: "b" }, env: {}, fetch, onStep: () => {} });
    await expect(remote.run()).rejects.toThrow(DemoGuardError);
    expect(state.calls).toEqual([]);
  });
});
