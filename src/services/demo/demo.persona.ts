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

import { DEMO_LEASE, demoInvoicePdf } from "./demo.documents";

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
 * `outbound-prospection` is the sales pack a head of sales would buy; `document-validation` checks the
 * leases and supplier invoices that cross his desk.
 */
export const DEMO_PACKS = ["orazaka-media", "outbound-prospection", "document-validation"] as const;

/** Studios on his shelf — what a sales lead at a product company uses in a week. */
export const DEMO_STUDIOS = [
  "image-generation",
  "video-generation",
  "speech-synthesis",
  "image-analysis",
  "compliance-check",
  "document-authenticity",
  "lead-research",
  "outbound-prospection",
  "followup-sequences",
] as const;

/** One piece of real work Eric has done: a Studio run on the local stack, with what he gave it. */
export interface DemoRun {
  readonly studioKey: string;
  /** What the run form receives; a function when the input is built at seed time (a PDF). */
  readonly inputs: Readonly<Record<string, unknown>> | (() => Readonly<Record<string, unknown>>);
  /** A heavy generation (video): only with `--with-video`, one at a time, never by default. */
  readonly heavy?: boolean;
}

/**
 * The work on his shelf after `orazaka demo seed --runs`: a product photo, a voice-over for the same lamp, a
 * prospect dossier, a lease checked against the law, a supplier invoice examined for tampering — and, with
 * `--with-video`, a few seconds of footage. Every result is generated on this machine by the real Studios;
 * the documents are invented (demo.documents.ts).
 */
export const DEMO_RUNS: readonly DemoRun[] = [
  {
    studioKey: "image-generation",
    inputs: { prompt: "Studio product photo of a hand-glazed ceramic table lamp, warm amber glow, dark slate plinth, deep ink-blue background, soft rim light" },
  },
  {
    studioKey: "speech-synthesis",
    inputs: { text: "Meet Ember, our new table lamp. Shaped by hand in Lyon, glazed in amber, and lit to make an evening feel like home." },
  },
  {
    studioKey: "lead-research",
    inputs: {
      prospects: ["Maison Lumière, concept store, Paris", "Hôtel des Canuts, boutique hotel, Lyon", "Atelier Nord, interior architects, Lille"],
      offer: "Hand-glazed ceramic lamps made to order, delivered in four weeks",
      icp: "Boutique hotels and interior architects furnishing 10 to 60 rooms",
    },
  },
  { studioKey: "compliance-check", inputs: { document: DEMO_LEASE, jurisdiction: "FR" } },
  { studioKey: "document-authenticity", inputs: () => ({ documentBase64: demoInvoicePdf().toString("base64"), expectedIssuer: "Emaux & Terres" }) },
  {
    studioKey: "video-generation",
    // The text-to-video pipeline by name: the catalogue's default video model is an image-to-video one, which starts
    // from a still and refuses this machine's memory without it.
    inputs: {
      prompt: "Slow orbit around a glowing amber ceramic table lamp on a dark slate plinth, soft light, ink-blue background",
      durationSeconds: 4,
      model: "ByteDance/AnimateDiff-Lightning",
    },
    heavy: true,
  },
];
