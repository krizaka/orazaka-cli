/**
 * @file cinema.staging.ts
 * @description The v3 gates of a cinematic short (orazaka#289, ADR-080 v3): what a frame-by-frame audit of « le relais »
 * and « Orochia : la première livraison » found wrong, each turned into a check.
 *
 * | Anomaly found | Where it is caught |
 * | --- | --- |
 * | birds without a contact shadow, shadow blobs floating in the air | `grounded`, `floatingShadow` questions |
 * | shadows against the light | the plate states its hard key (`light`), `shadowDirection` question |
 * | birds floating beside the surface they should stand on | `staging[].support` + `surface` (placed on it), `grounded` |
 * | wrong scale against the set | `staging[].scale` (a reference object and a ratio), `scaleFinding` |
 * | cut-out edges, flat cel birds pasted on photographs | `pasted` question |
 * | colour and light that do not match the plate | `pasted` question, measured `lumaRatio` / `chromaShift` |
 * | locked-off framings | `camera` vocabulary, `static` share in the cut, measured `cameraShift` / `zoom` on the take |
 * | motion that slides like a sticker | `sliding` question over four frames of the take |
 * | props and costumes that change between shots | `continuity` question over two shots that share a prop |
 * | birds that drift off their design in a take | `onModel` question against the character's render |
 * | a light burst that whites the frame out | measured `clippedSeconds` |
 *
 * And the brief of v3 (no narrator, music-video energy): `critiqueCut` refuses a narrator where the film has none, a cut
 * off the tempo, slow cutting, monotonous camera moves and a film without low angles or macro inserts.
 *
 * Pure: the caller (krizaka-ui tools/brand-films/v3/integrity.py) runs the vision model and measures the frames.
 */

/** Camera moves a shot may name. `locked` is the only static one: a choice, rationed by `MAX_STATIC_SHARE`. */
export const CAMERA_MOVES = [
  "handheld", "whip-pan", "dolly-in", "dolly-out", "tracking", "orbit", "crane-up", "fpv",
  "crane-down", "push-in", "pull-back", "tilt-up", "tilt-down", "snap-zoom", "locked",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const ANGLES = ["low", "eye", "high", "overhead", "macro", "dutch"] as const;
export type Angle = (typeof ANGLES)[number];

/** Where a key light comes from, as a plate prompt says it (« hard key light from the left »). */
export const KEYS = ["left", "right", "back-left", "back-right", "back", "front", "top"] as const;
export type Key = (typeof KEYS)[number];

/** How a character is held up in a shot: standing on a surface, flying, or carried by another. */
export const SUPPORTS = ["ground", "air", "held"] as const;
export type Support = (typeof SUPPORTS)[number];

/** At most this share of a film's shots may be locked off (« static framings », the v2 audit). */
// @fixed: the brief's « dynamic » made a number; a craft rule of the pack, not a business parameter.
export const MAX_STATIC_SHARE = 0.15;
/** The mean screen time of a shot (music-video cutting). */
// @fixed: a craft rule of the pack.
export const MAX_MEAN_SHOT_SECONDS = 2.2;
/** At least this many kinds of camera move in a film. */
// @fixed: a craft rule of the pack.
export const MIN_CAMERA_KINDS = 5;
/** At least this many low-angle or macro shots in a film. */
// @fixed: a craft rule of the pack.
export const MIN_LOW_OR_MACRO = 3;
/** A character's height against its reference may be off by this factor at most (0.7–1.43 of the asked ratio). */
// @fixed: the tolerance of a placement measured on a generated frame.
export const SCALE_TOLERANCE = 1.43;
/** A moving shot whose camera moves less than this share of the frame width per frame, and zooms less than MIN_ZOOM, is static. */
// @fixed: a threshold of the motion measure, a technical fact.
export const MIN_CAMERA_SHIFT = 0.0015;
// @fixed: a threshold of the motion measure, a technical fact.
export const MIN_ZOOM = 0.01;
/** The character's mean luminance against the plate around it: outside this range it does not belong to its light. */
// @fixed: a threshold of the light measure.
export const LUMA_RATIO = [0.55, 1.6] as const;
/** Mean chroma distance (CIELAB a*b*) between the character's light and the plate's beyond which they differ. */
// @fixed: a threshold of the colour measure.
export const MAX_CHROMA_SHIFT = 15;
/** Seconds of a take whited out (more than a third of the frame clipped) beyond which the burst hides the picture. */
// @fixed: a threshold of the exposure measure.
export const MAX_CLIPPED_SECONDS = 0.3;

export class StagingError extends Error {}

export interface Staging {
  readonly character: string;
  readonly support: Support;
  readonly surface?: string;
  readonly scale?: { readonly ref: string; readonly ratio: number };
}

export interface StagedShot {
  readonly id: number;
  readonly slug: string;
  readonly beats: number;
  readonly seconds: number;
  readonly characters: readonly string[];
  readonly camera: CameraMove;
  readonly angle: Angle;
  readonly light: { readonly key: Key; readonly hard: boolean };
  readonly plate: string;
  readonly staging: readonly Staging[];
  readonly props: readonly string[];
}

export interface StagedFilm {
  readonly narration: "none" | "narrator";
  readonly lines: number;
  readonly bpm: number;
  readonly shots: readonly StagedShot[];
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(String(value))) throw new StagingError(`${what} '${String(value)}' is not one of ${allowed.join(", ")}`);
  return value as T;
}

/**
 * The staging of a v3 treatment, read once: every character a shot shows stands on a named surface with a scale
 * reference, flies, or is held; the camera names a move and an angle; the light names its key. Refused by name otherwise.
 */
export function parseStaging(raw: Raw): StagedFilm {
  const score = (raw.score ?? {}) as Raw;
  const bpm = Number(score.bpm);
  if (!(bpm > 0)) throw new StagingError("the film's score names its tempo (score.bpm)");
  const beat = 60 / bpm;
  const shots = list(raw.shots).map((s, i): StagedShot => {
    const id = i + 1;
    const where = `shot ${id}`;
    const beats = Number(s.beats);
    if (!(beats > 0)) throw new StagingError(`${where}: its length is a number of beats (beats)`);
    const characters = list(s.characters).map(String);
    const staging = list(s.staging).map((g, k): Staging => {
      const character = str(g.character);
      const support = oneOf(g.support, SUPPORTS, `${where}: staging[${k}].support`);
      if (support === "ground") {
        if (!str(g.surface)) throw new StagingError(`${where}: ${character} stands on the ground but names no surface`);
        const sc = g.scale as Raw | undefined;
        if (!sc || !str(sc.ref) || !(Number(sc.ratio) > 0)) throw new StagingError(`${where}: ${character} stands on the ground but has no scale reference (scale.ref, scale.ratio)`);
        return { character, support, surface: str(g.surface), scale: { ref: str(sc.ref), ratio: Number(sc.ratio) } };
      }
      return { character, support };
    });
    for (const c of characters) {
      if (!staging.some((g) => g.character === c)) throw new StagingError(`${where}: ${c} is in the shot but not staged (ground, air or held)`);
    }
    const light = (s.light ?? {}) as Raw;
    return {
      id,
      slug: str(s.slug) || `shot-${id}`,
      beats,
      seconds: beats * beat,
      characters,
      camera: oneOf(s.camera, CAMERA_MOVES, `${where}: camera`),
      angle: oneOf(s.angle ?? "eye", ANGLES, `${where}: angle`),
      light: { key: oneOf(light.key, KEYS, `${where}: light.key`), hard: light.hard !== false },
      plate: str(s.plate),
      staging,
      props: list(s.props).map(String),
    };
  });
  return {
    narration: raw.narration === "narrator" ? "narrator" : "none",
    lines: list(raw.lines).length,
    bpm,
    shots,
  };
}

export interface CutFinding {
  readonly rule: "narrator" | "pace" | "static" | "camera" | "angle" | "light";
  readonly shot?: number;
  readonly message: string;
}

/** The words a plate prompt uses to say where its key light comes from. */
const KEY_WORDS: Record<Key, RegExp> = {
  left: /\b(from|on) the left\b/i,
  right: /\b(from|on) the right\b/i,
  "back-left": /\b(behind|back)[ -]?left\b|\bfrom (the )?back left\b/i,
  "back-right": /\b(behind|back)[ -]?right\b|\bfrom (the )?back right\b/i,
  back: /\b(backlit|from behind|behind the subject|contre-jour)\b/i,
  front: /\b(from the front|from the camera|frontal)\b/i,
  top: /\b(from above|overhead|top light)\b/i,
};

/** The cut of a v3 film (pure): no narrator where there is none, music-video pace, kinetic camera, lights that agree. */
export function critiqueCut(film: StagedFilm): { findings: CutFinding[]; pass: boolean } {
  const findings: CutFinding[] = [];
  if (film.narration === "none" && film.lines > 0) {
    findings.push({ rule: "narrator", message: `${film.lines} narrator line(s) in a film told without a narrator: tell it with picture, action and sound` });
  }
  const n = Math.max(1, film.shots.length);
  const mean = film.shots.reduce((a, s) => a + s.seconds, 0) / n;
  if (mean > MAX_MEAN_SHOT_SECONDS) findings.push({ rule: "pace", message: `the mean shot lasts ${mean.toFixed(2)} s (at most ${MAX_MEAN_SHOT_SECONDS} s)` });
  const locked = film.shots.filter((s) => s.camera === "locked").length;
  if (locked / n > MAX_STATIC_SHARE) findings.push({ rule: "static", message: `${locked} of ${film.shots.length} shots are locked off (at most ${Math.round(MAX_STATIC_SHARE * 100)} %)` });
  const kinds = new Set(film.shots.map((s) => s.camera).filter((c) => c !== "locked"));
  if (kinds.size < MIN_CAMERA_KINDS) findings.push({ rule: "camera", message: `${kinds.size} kind(s) of camera move (at least ${MIN_CAMERA_KINDS})` });
  const lowOrMacro = film.shots.filter((s) => s.angle === "low" || s.angle === "macro").length;
  if (lowOrMacro < MIN_LOW_OR_MACRO) findings.push({ rule: "angle", message: `${lowOrMacro} low-angle or macro shot(s) (at least ${MIN_LOW_OR_MACRO})` });
  for (const s of film.shots) {
    if (s.light.hard && s.plate && !KEY_WORDS[s.light.key].test(s.plate)) {
      findings.push({ rule: "light", shot: s.id, message: `the plate does not say its hard key comes ${s.light.key === "top" ? "from above" : `from the ${s.light.key}`}: the composite's shadows would not know where to fall` });
    }
  }
  return { findings, pass: findings.length === 0 };
}

// ── Frame questions (a local vision model, Qwen2.5-VL 7B, read strictly) ───────────────────────────────────────────

export type FrameCheck =
  | "grounded" | "floatingShadow" | "shadowDirection" | "pasted" | "onModel" | "continuity" | "sliding"
  | "static" | "colour" | "whiteout" | "scale";

/**
 * The questions, each with the answer that passes. `{character}`, `{surface}` and `{prop}` are filled per shot. A frame
 * passes a check only on a clear expected word: anything else (the other word, a hedge) fails it.
 */
export const FRAME_QUESTIONS = {
  grounded: {
    ask: "Look at {character}. Are its feet resting on {surface}, touching it, not floating above it or beside it? Answer YES or NO only.",
    pass: "YES",
  },
  floatingShadow: {
    ask: "Is there a dark shadow shape floating in the air in this image, not lying on any surface? Answer YES or NO only.",
    pass: "NO",
  },
  shadowDirection: {
    ask: "Do the shadows cast by the cartoon characters fall in the same direction as the shadows cast by the other objects in this scene? Answer YES or NO only.",
    pass: "YES",
  },
  pasted: {
    ask: "Does any cartoon character in this image look cut out and pasted onto the picture: a hard outline, a halo around it, flat colours, or a light and colour that do not match the scene around it? Answer YES or NO only.",
    pass: "NO",
  },
  onModel: {
    ask: "The first image is a character's reference design. Is the character in the second image the same design: the same colours, the same body shape, the same face and features? Answer YES or NO only.",
    pass: "YES",
  },
  continuity: {
    ask: "Is {prop} in the first image the same object as in the second image: the same shape, colour and size? Answer YES or NO only.",
    pass: "YES",
  },
  sliding: {
    ask: "These are four frames of one shot, in order. Does any character slide across the ground without stepping, float above the ground, or move like a flat cutout pasted on the picture? Answer YES or NO only.",
    pass: "NO",
  },
} as const satisfies Record<string, { ask: string; pass: "YES" | "NO" }>;

/** The vision model the questions were written for (Apache-2.0, local on MLX). */
export const FRAME_CHECK_MODEL = "Qwen2.5-VL-7B-Instruct";

/** Reads an answer strictly: true only when it starts with the expected word and nothing hedges it. */
export function parseYesNo(raw: string, expected: "YES" | "NO"): boolean {
  const text = raw.trim().toUpperCase();
  const word = text.match(/^(YES|NO)\b/)?.[1];
  if (word !== expected) return false;
  return !/\bBUT\b|\bHOWEVER\b|\bPARTLY\b/.test(text);
}

export interface Question {
  readonly check: keyof typeof FRAME_QUESTIONS;
  readonly question: string;
  readonly pass: "YES" | "NO";
}

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? k);

/**
 * The keyframe questions of a shot: each grounded character is asked whether it touches its surface; every character shot
 * is asked about floating shadows and pasted characters, and — under a hard key — about the direction of its shadows.
 */
export function questionsFor(shot: StagedShot, described: Readonly<Record<string, string>>): Question[] {
  if (shot.staging.length === 0) return [];
  const q = (check: keyof typeof FRAME_QUESTIONS, values: Record<string, string> = {}): Question => ({
    check,
    question: fill(FRAME_QUESTIONS[check].ask, values),
    pass: FRAME_QUESTIONS[check].pass,
  });
  const out: Question[] = [];
  for (const g of shot.staging) {
    if (g.support === "ground") out.push(q("grounded", { character: described[g.character] ?? `the ${g.character}`, surface: g.surface ?? "the ground" }));
  }
  out.push(q("floatingShadow"));
  if (shot.light.hard && shot.staging.some((g) => g.support === "ground")) out.push(q("shadowDirection"));
  out.push(q("pasted"));
  return out;
}

export interface FrameResult {
  readonly file: string;
  readonly check: FrameCheck;
  readonly pass: boolean;
}

export interface FrameGate {
  readonly pass: boolean;
  readonly rejected: readonly string[];
  readonly reviewed: boolean;
}

/** The gate: a file with one failed check is rejected; the film passes only when nothing is rejected and a person reviewed. */
export function frameGate(results: readonly FrameResult[], review?: { by: string; at: string }): FrameGate {
  const rejected = [...new Set(results.filter((r) => !r.pass).map((r) => r.file))].sort();
  const reviewed = Boolean(review?.by && review?.at);
  return { pass: results.length > 0 && rejected.length === 0 && reviewed, rejected, reviewed };
}

// ── Measured checks ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Scale: the measured height of a character (pixels) against its reference object's, compared with the asked ratio. */
export function scaleFinding(heights: { character: number; ref: number }, ratio: number): string | undefined {
  const measured = heights.character / Math.max(1, heights.ref);
  const factor = measured / ratio;
  if (factor <= SCALE_TOLERANCE && factor >= 1 / SCALE_TOLERANCE) return undefined;
  return `the character is ${factor.toFixed(1)}× the asked size against its reference (measured ${measured.toFixed(2)}, asked ${ratio})`;
}

export interface Measures {
  /** Median camera translation per frame, as a share of the frame width (phase correlation on the background). */
  readonly cameraShift?: number;
  /** Scale change over the take (a push-in or a zoom). */
  readonly zoom?: number;
  /** The character's mean luminance over the plate's around it. */
  readonly lumaRatio?: number;
  /** CIELAB a*b* distance between the character's mean colour cast and the plate's around it, after its own colours. */
  readonly chromaShift?: number;
  /** Seconds where more than a third of the frame is clipped white. */
  readonly clippedSeconds?: number;
}

/** What the measures say is wrong with a take or a keyframe (pure). */
export function measuredFindings(shot: { camera: string }, m: Measures): Array<{ check: FrameCheck; message: string }> {
  const out: Array<{ check: FrameCheck; message: string }> = [];
  if (shot.camera !== "locked" && m.cameraShift !== undefined) {
    if (m.cameraShift < MIN_CAMERA_SHIFT && (m.zoom ?? 0) < MIN_ZOOM) {
      out.push({ check: "static", message: `the shot asks for « ${shot.camera} » but the camera does not move (shift ${m.cameraShift.toFixed(4)}, zoom ${(m.zoom ?? 0).toFixed(3)})` });
    }
  }
  if (m.lumaRatio !== undefined && (m.lumaRatio < LUMA_RATIO[0] || m.lumaRatio > LUMA_RATIO[1])) {
    out.push({ check: "colour", message: `the character is ${m.lumaRatio.toFixed(2)}× as bright as the plate around it` });
  }
  if (m.chromaShift !== undefined && m.chromaShift > MAX_CHROMA_SHIFT) {
    out.push({ check: "colour", message: `the character's light differs in colour from the plate's (Δab ${m.chromaShift.toFixed(1)})` });
  }
  if (m.clippedSeconds !== undefined && m.clippedSeconds > MAX_CLIPPED_SECONDS) {
    out.push({ check: "whiteout", message: `${m.clippedSeconds.toFixed(2)} s of the take are whited out` });
  }
  return out;
}
