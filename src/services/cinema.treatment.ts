/**
 * @file cinema.treatment.ts
 * @description The shot-list planner of a cinematic short (orazaka#259, on ADR-080): a **treatment** — a film a person
 * directed, written as data — becomes the production's script without a language model. Each shot names its duration,
 * lens, camera, light, air, action, its cast (the continuity references: every character's reference render) and the
 * video model that makes it. Checked once, here: what a treatment gets wrong is refused by name, never guessed.
 *
 * Also the pure pieces the GPU side needs: the pending shots as jobs for a host that runs the worker's own generator
 * (`podJobs`), and the ffmpeg graphs of a cast's reference sheet and of a take's review sheet.
 */

import {
  type Aspect,
  type Character,
  type Production,
  RunState,
  type Script,
  type ScriptShot,
  type ScriptTitle,
  AMBIENCES,
  ASPECTS,
  GRADES,
  TITLE_STYLES,
  TRANSITIONS,
  motionPrompt,
  newProduction,
  seedFor,
} from "./cinema.production";

export class TreatmentError extends Error {}

/**
 * The video models a treatment may name: the licensed ones of the bake-off (docs/measurements, ADR-080) — Wan 2.2 I2V
 * A14B distilled (4 steps) and at full steps (40, `-hq`), LTX-Video 0.9.8 for camera-heavy landscape. HunyuanVideo was
 * refused for its licence (it excludes the EU, the UK and South Korea).
 */
export const VIDEO_MODELS = ["wan2.2-i2v-a14b", "wan2.2-i2v-a14b-hq", "ltx-video-0.9.8-13b-distilled"] as const;
export type VideoModel = (typeof VIDEO_MODELS)[number];

/** What each model makes from one still (orazaka-worker-media models.yaml): its frame per aspect, its frame count, its rate. */
const MODEL_SHAPE: Record<VideoModel, { sizes: Record<Aspect, [number, number]>; frames: number; fps: number }> = {
  "wan2.2-i2v-a14b": { sizes: { "16:9": [1280, 720], "9:16": [720, 1280] }, frames: 81, fps: 16 },
  "wan2.2-i2v-a14b-hq": { sizes: { "16:9": [1280, 720], "9:16": [720, 1280] }, frames: 81, fps: 16 },
  "ltx-video-0.9.8-13b-distilled": { sizes: { "16:9": [1216, 704], "9:16": [704, 1216] }, frames: 121, fps: 24 },
};

type Raw = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

function within<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(String(value))) {
    throw new TreatmentError(`${what} '${String(value)}' is not one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export interface PlanOptions {
  readonly language: "en" | "fr";
  /** Overrides the treatment's `seedBase`. */
  readonly seed?: number;
}

function shotOf(raw: Raw, index: number, cast: ReadonlySet<string>, cues: Record<string, Raw>, language: "en" | "fr"): ScriptShot {
  const id = index + 1;
  const where = `shot ${id}`;
  const seconds = Number(raw.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 5) throw new TreatmentError(`${where}: seconds must be between 1 and 5 (one clip)`);
  const characters = Array.isArray(raw.characters) ? raw.characters.map(String) : [];
  for (const c of characters) if (!cast.has(c)) throw new TreatmentError(`${where}: character '${c}' is not in the cast`);
  const keyframe = str(raw.keyframe);
  const motion = str(raw.motion);
  const reuse = str(raw.reuse);
  const chainRaw = raw.chainFrom as Raw | undefined;
  const chainFrom = chainRaw ? { shot: Number(chainRaw.shot), ...(chainRaw.at !== undefined ? { at: Number(chainRaw.at) } : {}) } : undefined;
  if (chainFrom && !(Number.isInteger(chainFrom.shot) && chainFrom.shot >= 1 && chainFrom.shot < id)) {
    throw new TreatmentError(`${where}: chainFrom names a shot before it`);
  }
  if (chainFrom?.at !== undefined && !(chainFrom.at >= 0 && chainFrom.at <= 5)) throw new TreatmentError(`${where}: chainFrom.at is a second (0 to 5)`);
  // A kept take needs neither prompt; a shot chained from another take needs no keyframe of its own.
  if (!keyframe && !reuse && !chainFrom) throw new TreatmentError(`${where}: a keyframe prompt is required`);
  if (!motion && !reuse) throw new TreatmentError(`${where}: a motion prompt is required`);
  const transition = id === 1 ? "cut" : within(raw.transition ?? "cut", TRANSITIONS, `${where}: transition`);
  const continuous = raw.continuous === true;
  if (continuous && id === 1) throw new TreatmentError("shot 1 cannot continue a shot before it");
  const chainAt = raw.chainAt === undefined || raw.chainAt === null ? undefined : Number(raw.chainAt);
  if (chainAt !== undefined && (!continuous || !Number.isFinite(chainAt) || chainAt < 0 || chainAt > 5)) {
    throw new TreatmentError(`${where}: chainAt is a second (0 to 5) of the previous take, for a continuous shot only`);
  }
  const speed = raw.speed === undefined ? 1 : Number(raw.speed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 2) throw new TreatmentError(`${where}: speed must be between 0.25 and 2`);
  const ramp = raw.rampAt === null || raw.rampAt === undefined ? null : Number(raw.rampAt);
  if (ramp !== null && !(ramp > 0.6 && ramp < seconds - 0.6 && speed === 1)) {
    throw new TreatmentError(`${where}: a ramp sits inside the shot (0.6 s from each end) and never with a whole-shot speed`);
  }
  const cueId = str(raw.caption);
  const cue = cues[cueId];
  return {
    id,
    seconds,
    characters,
    camera: str(raw.camera),
    lens: str(raw.lens),
    lighting: str(raw.lighting),
    atmosphere: str(raw.atmosphere),
    action: str(raw.action),
    vfx: str(raw.vfx),
    keyframe,
    motion,
    transition,
    speed,
    rampAt: ramp,
    // A caption names a cue of the treatment (the film's exact line in each language), or is its own words.
    caption: cue ? str(cue[language]) : cueId,
    continuous,
    ...(chainAt !== undefined ? { chainAt } : {}),
    ...(chainFrom ? { chainFrom } : {}),
    ...(reuse ? { reuse } : {}),
    model: within(raw.model ?? "wan2.2-i2v-a14b-hq", VIDEO_MODELS, `${where}: model`),
    slug: str(raw.slug) || `shot-${id}`,
  };
}

/** The treatment, checked once, as the script the director runs (pure). */
export function parseTreatment(raw: unknown, language: "en" | "fr"): Script {
  if (!raw || typeof raw !== "object") throw new TreatmentError("a treatment is a JSON object");
  const t = raw as Raw;
  const characters: Character[] = (Array.isArray(t.characters) ? t.characters : []).map((c: Raw) => {
    const id = str(c?.id);
    const description = str(c?.description);
    if (!id || !description) throw new TreatmentError("every character has an id and a description");
    return { id, description, ...(str(c.reference) ? { reference: str(c.reference) } : {}) };
  });
  const cast = new Set(characters.map((c) => c.id));
  const shotsRaw = Array.isArray(t.shots) ? (t.shots as Raw[]) : [];
  if (shotsRaw.length < 2) throw new TreatmentError("a treatment has at least two shots");
  if (shotsRaw.some((s, i) => Number(s?.id) !== i + 1)) throw new TreatmentError(`shots are numbered 1 to ${shotsRaw.length} in order`);
  const cues = (t.cues && typeof t.cues === "object" ? t.cues : {}) as Record<string, Raw>;
  const shots = shotsRaw.map((s, i) => shotOf(s, i, cast, cues, language));
  const titles: ScriptTitle[] = (Array.isArray(t.titles) ? (t.titles as Raw[]) : []).map((x) => ({
    text: str(x[language]) || str(x.text),
    start: Number(x.start) || 0,
    end: Number(x.end) || 0,
    style: within(x.style ?? "hero", TITLE_STYLES, "title style"),
  }));
  return {
    title: str(t.title) || "Untitled",
    logline: str(t.logline),
    grade: within(t.grade ?? "teal-orange", GRADES, "grade"),
    style: str(t.style),
    characters,
    music: str(t.music),
    ambience: within(t.ambience ?? "none", AMBIENCES, "ambience"),
    voiceover: str(t.voiceover),
    titles,
    shots,
    ...(str(t.keep) ? { keep: str(t.keep) } : {}),
    ...(str(t.keyframeKeep) ? { keyframeKeep: str(t.keyframeKeep) } : {}),
  };
}

/** A production planned from a treatment: its script is done (written by a person, recorded as such), its shots wait. */
export function planProduction(raw: unknown, options: PlanOptions): Production {
  const script = parseTreatment(raw, options.language);
  const t = raw as Raw;
  const aspect = within(t.aspect ?? "16:9", ASPECTS, "aspect");
  const seed = options.seed ?? (Number(t.seedBase) || 1);
  const production = newProduction({
    brief: script.logline || script.title,
    format: "custom",
    aspect,
    durationSeconds: Math.round(script.shots.reduce((sum, s) => sum + s.seconds / s.speed, 0)),
    shots: script.shots.length,
    language: options.language,
    seed,
  });
  production.script = { runId: "treatment", studioKey: "treatment", status: RunState.Succeeded, parsed: script };
  // A kept take (`reuse`) is done from the start: its file is the take, nothing is made or paid for it.
  production.shots = script.shots.map((s) =>
    s.reuse
      ? { id: s.id, attempt: 0, video: { runId: `reuse:${s.reuse}`, studioKey: "reuse", status: RunState.Succeeded, output: s.reuse } }
      : { id: s.id, attempt: 0 },
  );
  return production;
}

/**
 * A changed treatment applied to a production under way (pure): the script is the new one; every shot that is still in it
 * keeps what was made for it (keyframe, take, attempt), new shots wait, removed shots are dropped. The production's seed
 * and history are kept, so a shot's seed and the measured runs do not move.
 */
export function replan(production: Production, raw: unknown, options: PlanOptions): Production {
  const fresh = planProduction(raw, { ...options, seed: production.brief.seed });
  const kept = new Map(production.shots.map((s) => [s.id, s]));
  fresh.shots = fresh.shots.map((s) => kept.get(s.id) ?? s);
  fresh.characters = production.characters;
  fresh.history = production.history;
  return fresh;
}

/** One shot for a GPU host that runs the worker's own generator (orazaka-worker-media `generate_wan_frames`). */
export interface PodJob {
  /** `<id>-<slug>-t<attempt>`: the take's file name. */
  readonly name: string;
  readonly shot: number;
  readonly attempt: number;
  readonly model: VideoModel;
  readonly prompt: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly fps: number;
  /** Where the clip starts: its own keyframe, or the last frame of the shot before it (tail-frame chaining). */
  readonly start: { readonly keyframe: number } | { readonly lastFrameOf: number; readonly at?: number };
}

/**
 * How many frames a shot needs: the seconds it uses plus a 0.4 s handle for the cut (Wan holds its first frames on the
 * keyframe), rounded up to the model's 4k+1 (Wan) or 8k+1 (LTX) count and never more than one clip. A 2.7 s shot is made
 * as a 3.3 s clip, about half the attention work of a 5 s one at the same steps (pure).
 */
export function framesFor(shape: { frames: number; fps: number }, seconds: number): number {
  const step = shape.fps === 24 ? 8 : 4;
  const wanted = Math.ceil(((seconds + 0.4) * shape.fps) / step) * step + 1;
  return Math.min(shape.frames, Math.max(step * 4 + 1, wanted));
}

/** The shots still to make (never made, or marked for a reshoot), in order: what a GPU host runs next (pure). */
export function podJobs(production: Production): PodJob[] {
  const script = production.script?.parsed;
  if (!script) throw new TreatmentError("the production has no script yet");
  const aspect = production.brief.aspect;
  return script.shots.flatMap((shot, i): PodJob[] => {
    const state = production.shots.find((s) => s.id === shot.id);
    const done = state?.video?.status === RunState.Succeeded && state.review !== "reshoot";
    if (done || shot.reuse) return [];
    const attempt = state?.attempt ?? 0;
    const model = (shot.model ?? "wan2.2-i2v-a14b-hq") as VideoModel;
    const shape = MODEL_SHAPE[model] ?? MODEL_SHAPE["wan2.2-i2v-a14b-hq"];
    const [width, height] = shape.sizes[aspect];
    return [
      {
        name: `${String(shot.id).padStart(2, "0")}-${shot.slug ?? `shot-${shot.id}`}-t${attempt}`,
        shot: shot.id,
        attempt,
        model,
        prompt: motionPrompt(script, shot),
        seed: seedFor(production, shot.id, attempt, 2),
        width,
        height,
        frames: framesFor(shape, shot.seconds),
        fps: shape.fps,
        start: shot.chainFrom
          ? { lastFrameOf: shot.chainFrom.shot, ...(shot.chainFrom.at !== undefined ? { at: shot.chainFrom.at } : {}) }
          : shot.continuous && i > 0
            ? { lastFrameOf: script.shots[i - 1].id, ...(shot.chainAt !== undefined ? { at: shot.chainAt } : {}) }
            : { keyframe: shot.id },
      },
    ];
  });
}

/** ffmpeg arguments of a cast's reference sheet: each render, 512 high, side by side on neutral grey (pure). */
export function sheetArgs(renders: readonly string[], output: string): string[] {
  if (renders.length === 0) throw new TreatmentError("a reference sheet needs at least one render");
  const inputs = renders.flatMap((r) => ["-i", r]);
  const scaled = renders
    .map((_, i) => `color=0x808080:s=512x512[g${i}];[${i}:v]scale=-1:480[s${i}];[g${i}][s${i}]overlay=(W-w)/2:(H-h)/2:shortest=1[c${i}]`)
    .join(";");
  const join = renders.length > 1 ? `;${renders.map((_, i) => `[c${i}]`).join("")}hstack=inputs=${renders.length}[out]` : "";
  const last = renders.length > 1 ? "[out]" : "[c0]";
  return ["-v", "error", "-y", ...inputs, "-filter_complex", `${scaled}${join}`, "-map", last, "-frames:v", "1", output];
}

/**
 * ffmpeg arguments of a take's review sheet: a frame every `every` (81 frames: 11, tiled 6×2) under the cast's reference
 * sheet, so a person compares every moment of the take with the reference render before it is accepted (pure).
 */
export function reviewArgs(take: string, sheet: string, output: string, every = 8): string[] {
  const graph =
    `[0:v]select='not(mod(n\\,${every}))',scale=320:-2,tile=6x2:padding=4[frames];` +
    // Six 320-wide frames and five 4-px gaps make a 1940-wide strip: the reference sheet sits above it, 360 high, centred.
    `[1:v]scale=-2:360,pad=1940:376:(ow-iw)/2:8:color=0x202020[ref];[ref][frames]vstack[out]`;
  return ["-v", "error", "-y", "-i", take, "-i", sheet, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", output];
}

/**
 * Records a take a GPU host made outside the Studio (`podJobs`): the shot's video, with where the file is and how long it
 * took, so the production knows it is done and a later reshoot of it, or of the shot it is chained to, is counted (pure).
 */
export function recordTake(production: Production, shotId: number, output: string, seconds?: number, host = "pod"): Production {
  const state = production.shots.find((s) => s.id === shotId);
  if (!state) throw new TreatmentError(`shot ${shotId} is not in this production`);
  const record = {
    runId: `${host}:${String(shotId).padStart(2, "0")}-t${state.attempt}`,
    studioKey: "video-generation",
    status: RunState.Succeeded,
    output,
    ...(seconds !== undefined ? { seconds } : {}),
  };
  state.video = record;
  state.review = undefined;
  production.history.push(record);
  return production;
}
