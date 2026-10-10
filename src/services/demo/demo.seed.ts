/**
 * @file demo.seed.ts
 * @description Puts the demo persona (demo.persona.ts) on a local stack through the platform's own
 * public API — the same calls a person makes in the application, never a write into a database.
 *
 * Every step is replayable: an account that exists is signed into, a verified e-mail is not
 * verified twice, a pack or a Studio already held is left as it is. Running the seed twice gives
 * the state running it once gives.
 *
 * Conversation transcripts are not seeded here: the web client keeps them in the browser that held
 * them (useMessageHistory), so they are written by holding the conversations in the application
 * (orazaka-web-client `npm run record:tour -- prepare`).
 */

import { assertLocalDemoTarget } from "./demo.guard";
import { DEMO_CREDITS, DEMO_PACKS, DEMO_PERSONA, DEMO_PLAN, DEMO_STUDIOS } from "./demo.persona";

/** The part of `fetch` the seeder uses — injected so the steps are testable without a stack. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DemoSeedOptions {
  /** The edge (ROUTER_URL). */
  baseUrl: string;
  /** Mailpit, where the local stack delivers the verification e-mail. */
  mailUrl: string;
  password: string;
  admin: { email: string; password: string };
  env: Readonly<Record<string, string | undefined>>;
  fetch: Fetch;
  /** Progress lines for the command to print. */
  onStep: (line: string) => void;
  /** How long to wait for the verification e-mail (ms). */
  mailTimeoutMs?: number;
}

export interface DemoSeedResult {
  actorId: string;
  email: string;
  plan: string;
  credits: number;
  packs: string[];
  studios: string[];
}

interface LoginResponse {
  token: string;
  /** The forms the user still owes, by name (`onboarding`); the name is also the schema id. */
  activeInterceptions?: string[];
}

/** The subject of a session JWT: the actor id every service addresses the user by. */
export function actorIdOf(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("The session token is not a JWT.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub) throw new Error("The session token carries no subject.");
  return claims.sub;
}

/** The verification token in the e-mail the notification service sends (`…/verify?token=…`). */
export function verificationTokenIn(text: string): string | null {
  const match = /verify\?token=([A-Za-z0-9._~%-]+)/.exec(text);
  return match ? decodeURIComponent(match[1]) : null;
}

export class DemoSeeder {
  private readonly o: DemoSeedOptions;

  constructor(options: DemoSeedOptions) {
    this.o = options;
  }

  async run(): Promise<DemoSeedResult> {
    assertLocalDemoTarget(this.o.baseUrl, this.o.env);
    const login = await this.account();
    const token = login.token;
    const actorId = actorIdOf(token);
    await this.onboarding(token, login.activeInterceptions ?? []);
    await this.call("PUT", "/api/v1/profile/preferences", token, DEMO_PERSONA.preferences);
    this.o.onStep("Preferences set (English, Nova voice, 4:3 visuals)");
    const adminToken = await this.adminToken();
    await this.plan(actorId, adminToken);
    const credits = await this.credits(actorId, adminToken);
    const packs = await this.packs(token);
    const studios = await this.studios(token);
    return { actorId, email: DEMO_PERSONA.email, plan: DEMO_PLAN, credits, packs, studios };
  }

  /** Registers the account if needed, verifies it through the local mailbox, and signs in. */
  private async account(): Promise<LoginResponse> {
    const { username, email, language } = DEMO_PERSONA;
    const res = await this.raw("POST", "/api/v1/auth/register", undefined, { username, email, password: this.o.password, language });
    if (res.status === 201) {
      const body = (await res.json()) as { requires_verification?: boolean };
      this.o.onStep(`Account created: ${username} <${email}>`);
      if (body.requires_verification) await this.verify();
    } else if (res.status === 409) {
      this.o.onStep(`Account already exists: ${email}`);
    } else {
      throw new Error(`Registration failed: HTTP ${res.status} ${await res.text()}`);
    }
    let login = await this.raw("POST", "/api/v1/auth/login", undefined, { email, password: this.o.password });
    if (login.status === 401 && res.status === 409) {
      // An earlier run stopped before verifying: the e-mail is still in the local mailbox.
      await this.verify();
      login = await this.raw("POST", "/api/v1/auth/login", undefined, { email, password: this.o.password });
    }
    if (!login.ok) throw new Error(`Sign-in failed for ${email}: HTTP ${login.status}. Was the account created with another DEMO_PASSWORD?`);
    return (await login.json()) as LoginResponse;
  }

  /** Reads the newest verification e-mail for the persona in Mailpit and confirms it. */
  private async verify(): Promise<void> {
    const deadline = Date.now() + (this.o.mailTimeoutMs ?? 30_000);
    const query = encodeURIComponent(`to:"${DEMO_PERSONA.email}"`);
    for (;;) {
      const list = await this.o.fetch(`${this.o.mailUrl}/api/v1/search?query=${query}&limit=5`);
      if (list.ok) {
        const { messages = [] } = (await list.json()) as { messages?: { ID: string }[] };
        for (const m of messages) {
          const msg = await this.o.fetch(`${this.o.mailUrl}/api/v1/message/${m.ID}`);
          const { Text = "", HTML = "" } = (await msg.json()) as { Text?: string; HTML?: string };
          const token = verificationTokenIn(Text) ?? verificationTokenIn(HTML);
          if (!token) continue;
          const res = await this.raw("POST", "/api/v1/auth/verify", undefined, { token });
          if (res.ok) {
            this.o.onStep("E-mail verified through the local mailbox");
            return;
          }
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`No verification e-mail for ${DEMO_PERSONA.email} in ${this.o.mailUrl}: is the notifications service running?`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** Answers the onboarding form a new user meets at first sign-in, as Eric would. */
  private async onboarding(token: string, pending: string[]): Promise<void> {
    for (const name of pending) {
      // The web client resolves `/interceptions/<name>` with the name as both type and schema id.
      await this.call("POST", "/api/v1/interceptions/resolve", token, {
        interceptionType: name,
        schemaId: name,
        responses: DEMO_PERSONA.onboarding,
      });
      this.o.onStep(`Onboarding answered (${name})`);
    }
  }

  private async adminToken(): Promise<string> {
    const admin = await this.raw("POST", "/api/v1/auth/login", undefined, this.o.admin);
    if (!admin.ok) throw new Error(`Administrator sign-in failed (ADMIN_EMAIL): HTTP ${admin.status}`);
    return ((await admin.json()) as LoginResponse).token;
  }

  /** Puts Eric on the paid plan, as an administrator would. */
  private async plan(actorId: string, token: string): Promise<void> {
    const current = await this.raw("GET", `/api/v1/billing/subscriptions/${actorId}`, token);
    if (current.ok) {
      const sub = (await current.json()) as { planKey?: string; status?: string };
      if (sub.planKey === DEMO_PLAN && sub.status === "ACTIVE") {
        this.o.onStep(`Plan already ${DEMO_PLAN}`);
        return;
      }
    }
    await this.call("POST", `/api/v1/billing/subscriptions/${actorId}`, token, { planKey: DEMO_PLAN, status: "ACTIVE" });
    this.o.onStep(`Plan set to ${DEMO_PLAN}`);
  }

  /**
   * Tops the wallet up to the plan's period grant with an administrator adjustment: billing does
   * not write a period grant on a plan change yet, so without it a new subscriber starts at zero.
   * Only the difference is granted, so a replay never inflates the balance.
   */
  private async credits(actorId: string, token: string): Promise<number> {
    const res = await this.raw("GET", `/api/v1/billing/wallets/${actorId}`, token);
    let available = 0;
    if (res.ok) {
      const w = (await res.json()) as { balanceGranted?: number; balancePurchased?: number; held?: number };
      available = (w.balanceGranted ?? 0) + (w.balancePurchased ?? 0) - (w.held ?? 0);
    } else if (res.status !== 404) {
      throw new Error(`Wallet: HTTP ${res.status} ${await res.text()}`);
    }
    const missing = DEMO_CREDITS - available;
    if (missing <= 0) {
      this.o.onStep(`Credits already at ${available}`);
      return available;
    }
    await this.call("POST", `/api/v1/billing/wallets/${actorId}/adjustments`, token, {
      bucket: "GRANTED",
      amount: missing,
      reason: `Demo persona: ${DEMO_PLAN} period grant`,
    });
    this.o.onStep(`Credits topped up to ${DEMO_CREDITS}`);
    return DEMO_CREDITS;
  }

  private async packs(token: string): Promise<string[]> {
    for (const pack of DEMO_PACKS) {
      const res = await this.raw("POST", `/api/v1/billing/pack-subscriptions/me/${pack}`, token);
      if (!res.ok && res.status !== 409) throw new Error(`Pack ${pack}: HTTP ${res.status} ${await res.text()}`);
      this.o.onStep(res.status === 409 ? `Pack already held: ${pack}` : `Pack added: ${pack}`);
    }
    return [...DEMO_PACKS];
  }

  private async studios(token: string): Promise<string[]> {
    const installed = (await this.call("GET", "/api/v1/studios/installations", token)) as { studioKey: string }[];
    const held = new Set(installed.map((i) => i.studioKey));
    for (const key of DEMO_STUDIOS) {
      if (held.has(key)) {
        this.o.onStep(`Studio already installed: ${key}`);
        continue;
      }
      const res = await this.raw("POST", `/api/v1/studios/${key}/installations?locale=${DEMO_PERSONA.language}`, token, { config: {} });
      if (res.status === 409) {
        // A Studio a held pack includes has nothing to install: it runs directly (`studio_included`).
        const { status } = (await res.json()) as { status?: string };
        if (status !== "studio_included") throw new Error(`Studio ${key}: HTTP 409 ${String(status)}`);
        this.o.onStep(`Studio included in a pack: ${key}`);
        continue;
      }
      if (!res.ok) throw new Error(`Studio ${key}: HTTP ${res.status} ${await res.text()}`);
      this.o.onStep(`Studio installed: ${key}`);
    }
    return [...DEMO_STUDIOS];
  }

  private raw(method: string, path: string, token?: string, body?: unknown): Promise<Response> {
    return this.o.fetch(`${this.o.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async call(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
    const res = await this.raw(method, path, token, body);
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}
