/**
 * @file cinema.production.ts
 * @description A cinematic short as a production file (ADR-080): the script's shot list, checked once at the edge,
 * and every pure decision the director makes from it — the keyframe and motion prompts, the seeds, the edit decision
 * list of the cut, what runs next, and the estimate shown before anything runs.
 *
 * Nothing here talks to the platform: the director (cinema.director.ts) does, through ordinary Studio runs.
 */

/** The formats the script Studio knows (cinematic-script's `format` input). */
export const FORMATS = ["superhero-vfx", "social-reel", "news-explainer", "trailer", "custom"] as const;
export type Format = (typeof FORMATS)[number];

export const ASPECTS = ["9:16", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** The cut's grades and transitions (orazaka-worker-media app/cut.py): a script naming another is corrected here. */
export const GRADES = ["none", "teal-orange", "neon-night", "warm-film", "clean-news", "nordic"] as const;
export const TRANSITIONS = ["cut", "fade", "dissolve", "black", "flash", "whip", "slide", "radial", "iris"] as const;
export const TITLE_STYLES = ["hero", "kicker", "lower-third", "end"] as const;
/** The cut's synthesized ambience beds (orazaka-worker-media app/cut.py AMBIENCES). */
export const AMBIENCES = ["none", "rain", "storm", "wind", "city", "room", "nature"] as const;

/** The state of one Studio run of the production, as the platform reported it. */
export const RunState = {
  Pending: "PENDING",
  Running: "RUNNING",
  Succeeded: "SUCCEEDED",
  Failed: "FAILED",
} as const;
export type RunState = (typeof RunState)[keyof typeof RunState];

/** One Studio run of the production: which run, its state, what it made, and how long it took (the platform's clock). */
export interface RunRecord {
  readonly runId: string;
  readonly studioKey: string;
  readonly status: RunState | string;
  readonly output?: string;
  readonly assetId?: string;
  readonly seconds?: number;
  /** The platform's own clock: when the run started and finished (ISO 8601). */
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: string;
  readonly seed?: number;
}

export interface Character {
  readonly id: string;
  readonly description: string;
}

export interface ScriptShot {
  readonly id: number;
  readonly seconds: number;
  readonly characters: readonly string[];
  readonly camera: string;
  /** The Krizaka cinematic kit (ADR-080): the lens in mm, the light, the air. */
  readonly lens: string;
  readonly lighting: string;
  readonly atmosphere: string;
  readonly action: string;
  readonly vfx: string;
  readonly keyframe: string;
  readonly motion: string;
  readonly transition: (typeof TRANSITIONS)[number];
  readonly speed: number;
  readonly rampAt: number | null;
  readonly caption: string;
  /** Starts from the previous shot's last frame instead of its own keyframe (last-frame chaining). */
  readonly continuous: boolean;
}

export interface ScriptTitle {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly style: (typeof TITLE_STYLES)[number];
}

export interface Script {
  readonly title: string;
  readonly logline: string;
  readonly grade: (typeof GRADES)[number];
  readonly style: string;
  readonly characters: readonly Character[];
  readonly music: string;
  readonly ambience: (typeof AMBIENCES)[number];
  readonly voiceover: string;
  readonly titles: readonly ScriptTitle[];
  readonly shots: readonly ScriptShot[];
}

export interface Brief {
  readonly brief: string;
  readonly format: Format;
  readonly aspect: Aspect;
  readonly durationSeconds: number;
  readonly shots: number;
  readonly language: "en" | "fr";
  /** The production's seed: every keyframe and shot seed is derived from it, so a production can be made again. */
  readonly seed: number;
  /** A voice of the speech catalogue for the voice-over (empty: the catalogue's default). */
  readonly voice?: string;
  /** The language model that writes the script (empty: the catalogue's chat default). */
  readonly scriptModel?: string;
}

export interface ShotState {
  readonly id: number;
  keyframe?: RunRecord;
  video?: RunRecord;
  /** A person's verdict after looking at the shot: a rejected shot is made again with a new seed. */
  review?: "ok" | "reshoot";
  attempt: number;
}

export interface Production {
  readonly version: 1;
  readonly brief: Brief;
  script?: RunRecord & { readonly parsed?: Script };
  characters: Record<string, RunRecord>;
  shots: ShotState[];
  cut?: RunRecord;
  voice?: RunRecord;
  sound?: RunRecord;
  /** Every run the production started, in order, failures included: the record Measured runs is generated from. */
  history: RunRecord[];
}

export class ScriptError extends Error {}

/** A value as one line of text: a string as it is, an object or list the model wrote instead as its values joined. */
const flatten = (value: unknown): string =>
  value !== null && typeof value === "object" ? Object.values(value as object).map(flatten).join(", ") : String(value ?? "");
/** Markdown emphasis a model adds (`**bold**`, `*italic*`) is not a word of the prompt nor of a title. */
const text = (value: unknown, max = 1200): string =>
  flatten(value).replace(/\*+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(value)) ? (String(value) as T) : fallback;

/** The JSON object inside an LLM's answer: the whole text, or the first `{` to the last `}` (a fenced block). */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ScriptError("the script holds no JSON object");
  const body = raw.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (error: unknown) {
    // A language model's usual slip: a missing comma between two members, or a trailing one. Repaired once,
    // then parsed; anything else is refused with the parser's own message.
    try {
      return JSON.parse(repairJson(body));
    } catch {
      throw new ScriptError(`the script is not valid JSON (${error instanceof Error ? error.message : "parse error"})`);
    }
  }
}

/** Inserts the commas a model forgot between members on separate lines, and drops trailing ones (pure). */
export function repairJson(body: string): string {
  // Raw line breaks inside a string literal are not JSON: they become spaces (a walk that knows when it is in a string).
  let inString = false;
  let escaped = false;
  let flat = "";
  for (const char of body) {
    if (inString && (char === "\n" || char === "\r" || char === "\t")) {
      flat += " ";
      continue;
    }
    if (char === '"' && !escaped) inString = !inString;
    escaped = char === "\\" && !escaped;
    flat += char;
  }
  // A bare value with units (`35mm`, `68 BPM`) is a string the model forgot to quote — looked for outside the strings only.
  const quoted = flat
    .split(/("(?:[^"\\]|\\.)*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/:\s*(-?\d[^",\n{}[\]]*?[A-Za-z%][^",\n{}[\]]*?)\s*(?=[,\n}\]])/g, ': "$1"')))
    .join("");
  return quoted
    .replace(/("|\}|\]|\d|true|false|null)(\s*\n\s*)(?=["{[])/g, "$1,$2")
    .replace(/,(\s*[}\]])/g, "$1");
}

/**
 * The script's answer, checked once: parse, don't validate. What the cut cannot make (an unknown grade or transition) is
 * corrected to the nearest safe value; what the film cannot be made without (no shots, a shot without a keyframe) is
 * refused. The shot count is bounded by what was asked.
 */
export function parseScript(raw: string, brief: Brief): Script {
  const data = extractJson(raw) as Record<string, unknown>;
  const shotsRaw = Array.isArray(data.shots) ? data.shots : [];
  if (shotsRaw.length < 2) throw new ScriptError("the script has fewer than two shots");
  const characters: Character[] = (Array.isArray(data.characters) ? data.characters : [])
    .map((c: Record<string, unknown>) => ({ id: text(c?.id, 40), description: text(c?.description, 600) }))
    .filter((c) => c.id && c.description)
    .slice(0, 6);
  const known = new Set(characters.map((c) => c.id));
  const shots: ScriptShot[] = shotsRaw.slice(0, Math.max(brief.shots, 2)).map((s: Record<string, unknown>, i: number) => {
    const keyframe = text(s?.keyframe);
    if (!keyframe) throw new ScriptError(`shot ${i + 1} has no keyframe prompt`);
    const seconds = clamp(Number(s?.seconds) || 5, 2, 5);
    const speed = Number(s?.speed) === 0.5 ? 0.5 : 1;
    const ramp = s?.rampAt === null || s?.rampAt === undefined ? null : Number(s.rampAt);
    return {
      id: i + 1,
      seconds,
      characters: (Array.isArray(s?.characters) ? s.characters : []).map((c) => text(c, 40)).filter((c) => known.has(c)),
      camera: text(s?.camera, 300),
      lens: text(s?.lens, 60),
      lighting: text(s?.lighting, 300),
      atmosphere: text(s?.atmosphere, 200),
      action: text(s?.action, 500),
      vfx: text(s?.vfx, 400),
      keyframe,
      motion: text(s?.motion, 800) || text(s?.action, 500),
      transition: i === 0 ? "cut" : oneOf(s?.transition, TRANSITIONS, "cut"),
      speed,
      // A ramp needs room on both sides of it and is never combined with a whole-shot slow motion.
      rampAt: speed === 1 && ramp !== null && Number.isFinite(ramp) && ramp > 0.6 && ramp < seconds - 0.6 ? ramp : null,
      caption: text(s?.caption, 140),
      continuous: s?.continuous === true && i > 0,
    };
  });
  const titles: ScriptTitle[] = (Array.isArray(data.titles) ? data.titles : [])
    .map((t: Record<string, unknown>) => ({
      text: text(t?.text, 120),
      start: Math.max(0, Number(t?.start) || 0),
      end: Math.max(0, Number(t?.end) || 0),
      style: oneOf(t?.style, TITLE_STYLES, "hero"),
    }))
    .filter((t) => t.text && t.end > t.start + 0.2)
    .slice(0, 8);
  return {
    title: text(data.title, 120) || "Untitled",
    logline: text(data.logline, 300),
    grade: oneOf(data.grade, GRADES, "teal-orange"),
    style: text(data.style, 800),
    characters,
    music: text(data.music, 480) || "cinematic orchestral score, building tension, no vocals",
    ambience: oneOf(data.ambience, AMBIENCES, "none"),
    voiceover: text(data.voiceover, 1800),
    titles,
    shots,
  };
}

/** A new, empty production for a brief. */
export function newProduction(brief: Brief): Production {
  return { version: 1, brief, characters: {}, shots: [], history: [] };
}

/** The deterministic seed of one keyframe or shot: the production's seed, the shot, the attempt (a reshoot is a new seed). */
export function seedFor(production: Production, shotId: number, attempt: number, salt = 0): number {
  return (production.brief.seed + shotId * 7919 + attempt * 104729 + salt * 31) % 2147483647;
}

/** The image size of a keyframe for an aspect (image-generation's `size` enum). */
export const keyframeSize = (aspect: Aspect): string => (aspect === "9:16" ? "768x1360" : "1360x768");

const NO_TEXT = "No text, no letters, no logos, no watermark, no brand names.";

/** The Krizaka cinematic kit's finish, said in every picture: what makes a frame read as a film, not a render. */
export const KIT_FINISH =
  "Shot on a cinema camera, anamorphic film look, natural skin texture, motivated lighting, filmic contrast, subtle film grain, " +
  "high dynamic range, sharp focus on the subject, photorealistic, highly detailed";

/** A shot's direction in one sentence: the lens, the camera, the light and the air (only what the script gave). */
export function direction(shot: ScriptShot): string {
  return [
    shot.lens ? `${/mm/i.test(shot.lens) ? shot.lens : `${shot.lens}mm`} lens` : "",
    shot.camera ? `camera: ${shot.camera}` : "",
    shot.lighting ? `lighting: ${shot.lighting}` : "",
    shot.atmosphere ? `atmosphere: ${shot.atmosphere}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The still of a character, first: the reference a person looks at before any shot is paid. */
export function characterPrompt(script: Script, character: Character): string {
  return text(
    `Character reference portrait, waist up, three-quarter view, neutral studio background: ${character.description}. ` +
      `Style: ${script.style} Original character design. ${NO_TEXT}`,
    1900,
  );
}

/**
 * The keyframe prompt of a shot: the shot's own first frame, then every character in it described in full, then the
 * visual bible — the same words in every picture are what keep a face and a look from shot to shot.
 */
export function keyframePrompt(script: Script, shot: ScriptShot, aspect: Aspect): string {
  const cast = shot.characters
    .map((id) => script.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c))
    .map((c) => `${c.id}: ${c.description}`)
    .join(". ");
  return text(
    `${shot.keyframe}. ${cast ? `${cast}. ` : ""}${shot.vfx ? `Effects: ${shot.vfx}. ` : ""}` +
      `Style: ${script.style} Cinematic film still, ${aspect === "9:16" ? "vertical 9:16" : "widescreen 16:9"} composition, ` +
      `${direction(shot)}. ${KIT_FINISH}. ${NO_TEXT}`,
    1900,
  );
}

export const KEYFRAME_NEGATIVE =
  "text, letters, caption, watermark, logo, signature, deformed hands, extra fingers, extra limbs, fused fingers, " +
  "distorted face, plastic skin, oversaturated, cartoon, 3d render, cgi look, blurry, low quality, jpeg artifacts";

/** The motion prompt of a shot: what moves, the effects, the camera, the look. */
export function motionPrompt(script: Script, shot: ScriptShot): string {
  return text(
    `${shot.motion}. ${shot.vfx ? `Visual effects: ${shot.vfx}. ` : ""}${direction(shot)}. ` +
      `${script.style} Cinematic, smooth natural motion, stable faces and hands, the same characters throughout, ${NO_TEXT}`,
    1900,
  );
}

/** Seconds of a 5-second clip a shot uses: Wan's first frames hold the keyframe still, so the head is trimmed. */
const HEAD_TRIM = 0.15;
const CLIP_SECONDS = 5.0;
const TRANSITION_SECONDS = 0.35;

/** The edit decision list of the cut (cinematic-cut's `edit`), from the script and the order of the shots. */
export function editDecisionList(production: Production, script: Script): Record<string, unknown> {
  const shots = script.shots.map((shot, i) => {
    const out = Math.min(CLIP_SECONDS, HEAD_TRIM + shot.seconds);
    return {
      clip: i,
      in: HEAD_TRIM,
      out: Number(out.toFixed(2)),
      speed: shot.speed,
      ...(shot.rampAt !== null ? { rampAt: Number((HEAD_TRIM + shot.rampAt).toFixed(2)), rampSpeed: 0.4 } : {}),
      zoom: shot.speed < 1 || shot.rampAt !== null ? 1.0 : 1.04,
      transition: shot.transition,
      ...(shot.transition !== "cut" ? { transitionSeconds: TRANSITION_SECONDS } : {}),
      caption: shot.caption,
    };
  });
  const length = filmSeconds(script);
  const titles = script.titles
    .filter((t) => t.start < length - 0.5)
    .map((t) => ({ ...t, end: Math.min(t.end, length) }));
  // Hollywood finishing (ADR-080): every shot upscaled by SeedVR2 before the cut, the ambience bed and the hits under it.
  return {
    aspect: production.brief.aspect,
    fps: 30,
    grade: script.grade,
    shots,
    titles,
    label: "AI-generated",
    upscale: "seedvr2",
    ambience: script.ambience,
    sfx: true,
  };
}

/** How long the finished film is: each shot's screen time (slow motion and ramps included) minus the overlaps. */
export function filmSeconds(script: Script): number {
  let total = 0;
  script.shots.forEach((shot, i) => {
    const screen =
      shot.rampAt !== null ? shot.rampAt + (shot.seconds - shot.rampAt) / 0.4 : shot.seconds / shot.speed;
    total += screen - (i === 0 ? 0 : shot.transition === "cut" ? 1 / 30 : TRANSITION_SECONDS);
  });
  return Number(total.toFixed(2));
}

/** The next thing a production needs, in order — what `orazaka cinema run` does next, and where a resume picks up. */
export type NextStep =
  | { readonly kind: "script" }
  | { readonly kind: "character"; readonly id: string }
  | { readonly kind: "keyframe"; readonly shot: number }
  | { readonly kind: "video"; readonly shot: number }
  | { readonly kind: "cut" }
  | { readonly kind: "voice" }
  | { readonly kind: "sound" }
  | { readonly kind: "done" };

const done = (run?: RunRecord): boolean => run?.status === RunState.Succeeded;

export function nextStep(production: Production): NextStep {
  const script = production.script?.parsed;
  if (!script || !done(production.script)) return { kind: "script" };
  for (const character of script.characters) {
    if (!done(production.characters[character.id])) return { kind: "character", id: character.id };
  }
  for (const shot of script.shots) {
    const state = production.shots.find((s) => s.id === shot.id);
    if (!done(state?.keyframe) && !shot.continuous) return { kind: "keyframe", shot: shot.id };
  }
  for (const shot of script.shots) {
    const state = production.shots.find((s) => s.id === shot.id);
    if (!done(state?.video) || state?.review === "reshoot") return { kind: "video", shot: shot.id };
  }
  if (!done(production.cut)) return { kind: "cut" };
  if (script.voiceover && !done(production.voice)) return { kind: "voice" };
  if (!done(production.sound)) return { kind: "sound" };
  return { kind: "done" };
}

/** Marks shots to be made again (a person's review): their video, and the cut and sound that used them, are redone. */
export function markReshoot(production: Production, ids: readonly number[], newKeyframe = false): Production {
  for (const id of ids) {
    const state = production.shots.find((s) => s.id === id);
    if (!state) throw new ScriptError(`shot ${id} is not in this production`);
    state.review = "reshoot";
    state.attempt += 1;
    if (newKeyframe) state.keyframe = undefined;
  }
  production.cut = undefined;
  production.sound = undefined;
  return production;
}

/** What one Studio run costs and takes, as measured (cinema-estimate.json): the figures the estimate multiplies. */
export interface StepMeasure {
  readonly studioKey: string;
  readonly seconds: number;
  readonly gpuUsd: number;
}

export interface Estimate {
  readonly lines: ReadonlyArray<{ step: string; count: number; credits: number; seconds: number; gpuUsd: number }>;
  readonly credits: number;
  readonly seconds: number;
  readonly gpuUsd: number;
  readonly filmSeconds: number;
}

/**
 * The estimate shown before a production runs: per step, how many runs, the Studio's own estimated credits (from the
 * catalogue), and the measured time and GPU cost of one run. Steps already done are not counted again.
 */
export function estimate(
  production: Production,
  shotCount: number,
  credits: Readonly<Record<string, number>>,
  measures: Readonly<Record<string, StepMeasure>>,
): Estimate {
  const script = production.script?.parsed;
  const characterCount = script ? script.characters.length : 2;
  const shots = script ? script.shots : [];
  const pending = (key: "keyframe" | "video"): number =>
    script
      ? shots.filter((s) => {
          if (key === "keyframe" && s.continuous) return false; // it starts from the shot before it
          const state = production.shots.find((x) => x.id === s.id);
          return !done(state?.[key]) || (key === "video" && state?.review === "reshoot");
        }).length
      : shotCount;
  const rows: Array<[string, number]> = [
    ["script", done(production.script) ? 0 : 1],
    ["character", script ? script.characters.filter((c) => !done(production.characters[c.id])).length : characterCount],
    ["keyframe", pending("keyframe")],
    ["video", pending("video")],
    ["cut", done(production.cut) ? 0 : 1],
    ["voice", script && !script.voiceover ? 0 : done(production.voice) ? 0 : 1],
    ["sound", done(production.sound) ? 0 : 1],
  ];
  const lines = rows.map(([step, count]) => {
    const measure = measures[step];
    const studio = measure?.studioKey ?? step;
    return {
      step,
      count,
      credits: count * (credits[studio] ?? 0),
      seconds: count * (measure?.seconds ?? 0),
      gpuUsd: Number((count * (measure?.gpuUsd ?? 0)).toFixed(2)),
    };
  });
  const sum = (key: "credits" | "seconds" | "gpuUsd"): number => lines.reduce((total, line) => total + line[key], 0);
  return {
    lines,
    credits: sum("credits"),
    seconds: Math.round(sum("seconds")),
    gpuUsd: Number(sum("gpuUsd").toFixed(2)),
    filmSeconds: script ? filmSeconds(script) : production.brief.durationSeconds,
  };
}
