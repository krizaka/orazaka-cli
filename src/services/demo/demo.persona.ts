/**
 * @file demo.persona.ts
 * @description The demonstration persona: who signs in when Orazaka is shown to a client.
 *
 * "admin" is a role, not a person — nobody watching a demo can picture themselves in it. Eric is
 * an invented head of sales at an invented lighting studio: a first name a client can read at a
 * glance, a generic surname, a reserved e-mail domain (RFC 2606, `example.com`, never delivered)
 * and no avatar but his initial. Nothing here describes a real person or a real company.
 *
 * Pure data: the seeder (demo.seed.ts) decides how each line reaches the platform.
 */

/** The account and the profile answers a new user gives at onboarding. */
export const DEMO_PERSONA = {
  /** What the application greets: "Good evening, Eric". */
  username: "Eric",
  fullName: "Eric Morel",
  email: "eric.morel@example.com",
  /** Overridable with DEMO_PASSWORD; only ever used against a local stack (demo.guard.ts). */
  defaultPassword: "Demo-Lumen-2026",
  language: "en",
  company: "Lumen Atelier",
  /** Onboarding answers (krizaka-users stores them as profile attributes, never interprets them). */
  onboarding: {
    theme: "amber",
    voiceModel: "nova",
    primaryIndustry: "creative",
    aiBehavior:
      "Eric leads sales at Lumen Atelier, a small studio that designs ceramic lamps. Answer clearly, in short paragraphs, and end with the next step.",
  },
  /** Preferences the client reads (profile → Appearance, chat defaults). */
  preferences: {
    language: "en",
    "tts-voice": "nova",
    "image-aspect-ratio": "4:3",
    "chat-temperature": 0.6,
  },
} as const;

/** The plan Eric is on: the paid tier a client would buy, so every Studio below is unlocked. */
export const DEMO_PLAN = "premium";

/** Credits in his wallet: the premium period grant in v2 credits (ADR-047: 5 000 × 10). */
export const DEMO_CREDITS = 50_000;

/**
 * Packs Eric holds. `orazaka-media` (generate, listen, describe) is included with every plan;
 * `outbound-prospection` is the sales pack a head of sales would buy.
 */
export const DEMO_PACKS = ["orazaka-media", "outbound-prospection"] as const;

/** Studios on his shelf — what a sales lead at a product company uses in a week. */
export const DEMO_STUDIOS = [
  "image-generation",
  "image-analysis",
  "lead-research",
  "outbound-prospection",
  "followup-sequences",
] as const;
