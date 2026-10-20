/**
 * @file cinema.story.ts
 * @description The treatment stage of a cinematic short (orazaka#289, ADR-080 addendum v2): a short brief becomes a
 * **story** before it becomes a shot list — an arc (hook → journey → turn → payoff), each character's intention, a theme,
 * and for every shot a purpose, an action that serves its beat, a gaze and the physics that make a character alive; the
 * narrator's lines with their direction (emotion, pace, emphasis) and the shots they land on; music cues that follow the
 * arc; a sound list per shot.
 *
 * Everything here is pure: the **rubric** that rejects flat beats, off-topic action, a story without a turn or a line
 * that cannot fit its shots (`critiqueStory`), the prompt and the parser of the language-model judge that reads the
 * same rubric (`judgePrompt`, `parseJudge`), their verdict together (`verdict`), the timeline that aligns every line,
 * music cue and sound to the cut (`timeline`), and the directed motion prompt of a shot (`directedMotion`).
 */

/** The four beats of a short's arc, in the order a story must meet them. */
export const BEATS = ["hook", "journey", "turn", "payoff"] as const;
export type Beat = (typeof BEATS)[number];

/** The sounds the foley step can lay (orazaka-worker-media app/foley.py): beds, then events placed at a second of the shot. */
export const SOUND_BEDS = ["rain", "storm", "wind", "wind-soft", "lake", "waves", "drizzle", "room", "dawn", "city", "rain-window", "drips"] as const;
export const SOUND_EVENTS = [
  "thunder", "gust", "flap", "whoosh", "steps", "rustle", "shake", "paper", "block", "hum", "ignite", "chime", "call",
  "chirp", "splash", "splash-small", "coin", "parcel", "tap", "swell",
] as const;
export const SOUND_KINDS = [...SOUND_BEDS, ...SOUND_EVENTS] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/**
 * What characters do to each other in a shot (orazaka#289, Oussama's review: « they look presented, not part of a story »):
 * a story where they meet, help, argue and hand off is told by these.
 */
export const INTERACTIONS = ["meet", "help", "argue", "handoff", "tease", "celebrate", "compete", "rescue"] as const;
export type InteractionKind = (typeof INTERACTIONS)[number];

/** Pace of a line: what the voice step turns into a speaking rate. */
export const PACES = ["slow", "measured", "rhythmic", "lively"] as const;
export type Pace = (typeof PACES)[number];

export class StoryError extends Error {}

export interface ArcBeat {
  readonly beat: Beat;
  readonly purpose: string;
  readonly emotion: string;
  /** How loud the music may be in this beat, 0..1 (the score follows the arc: low in, a build, a resolve). */
  readonly intensity: number;
}

export interface LineDirection {
  readonly emotion: string;
  readonly pace: Pace;
  readonly emphasis: readonly string[];
  /** Silence after the line, in seconds. */
  readonly pauseAfter: number;
}

export interface StoryLine {
  readonly id: string;
  /** The shots the line is said over (ids, consecutive): it starts on the first and ends before the last one does. */
  readonly shots: readonly number[];
  readonly text: Readonly<Record<string, string>>;
  readonly direction: LineDirection;
}

export interface MusicCue {
  /** The beat the cue scores, or (with `shots`) the beat its first shot belongs to. */
  readonly beat: Beat;
  /** The shots the cue spans (first and last id): a score that changes genre with the place, not only with the beat. */
  readonly shots?: readonly [number, number];
  /** Its genre (soft, hip-hop, electro, rock, G-funk…): what the music map says. */
  readonly genre?: string;
  readonly intensity: number;
  readonly prompt: string;
}

export interface SoundCue {
  readonly kind: SoundKind;
  /** Second of the shot an event lands on; absent: a bed under the whole shot. */
  readonly at?: number;
  /** Level in dB before the mix (only the balance matters: the master is set to -14 LUFS). */
  readonly gain: number;
}

export interface StoryCharacter {
  readonly id: string;
  readonly description: string;
  readonly promise: string;
  readonly intention: string;
}

export interface StoryShot {
  readonly id: number;
  readonly slug: string;
  readonly seconds: number;
  readonly speed: number;
  readonly beat: Beat;
  readonly purpose: string;
  readonly characters: readonly string[];
  readonly action: string;
  readonly intent: string;
  readonly gaze: string;
  readonly physics: string;
  readonly interaction: string;
  /** What the characters do to each other, when the shot holds more than one. */
  readonly interactionKind?: InteractionKind;
  /** Where it happens (a place of the journey). */
  readonly place: string;
  readonly framing: string;
  readonly camera: string;
  readonly lens: string;
  readonly lighting: string;
  readonly atmosphere: string;
  readonly motion: string;
  readonly transition: string;
  /** A take kept from an earlier production (no new run). */
  readonly reuse?: string;
  /** Starts from a frame of an earlier shot's take (continuity across a cut). */
  readonly chainFrom?: { readonly shot: number; readonly at?: number };
  readonly sound: readonly SoundCue[];
}

/** A cultural reference the film evokes, and how it does so without anyone's likeness, work or trade dress. */
export interface Reference {
  readonly evokes: string;
  /** The original or generic means: a genre of original music, a generic object, an original nod drawn in our style. */
  readonly how: string;
}

export interface Story {
  readonly title: string;
  /** What the film evokes and how (the legal log of orazaka#289), and the names it must never say or show. */
  readonly references: readonly Reference[];
  readonly never: readonly string[];
  readonly logline: string;
  readonly theme: string;
  readonly arc: readonly ArcBeat[];
  readonly characters: readonly StoryCharacter[];
  readonly lines: readonly StoryLine[];
  readonly music: { readonly prompt: string; readonly cues: readonly MusicCue[] };
  readonly shots: readonly StoryShot[];
}

type Raw = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const num = (value: unknown, fallback: number): number => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback);
const list = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(String(value))) throw new StoryError(`${what} '${String(value)}' is not one of ${allowed.join(", ")}`);
  return value as T;
}

/**
 * A treatment's story, read once (parse, don't validate): what cannot be a story is refused by name — an unknown beat,
 * a line on a shot that does not exist, a sound the foley step cannot make. What makes a story *good* is the rubric's
 * job (`critiqueStory`), not the parser's.
 */
export function parseStory(raw: unknown): Story {
  if (!raw || typeof raw !== "object") throw new StoryError("a treatment is a JSON object");
  const t = raw as Raw;
  const arc = list(t.arc).map((a, i) => ({
    beat: oneOf(a.beat, BEATS, `arc[${i}].beat`),
    purpose: str(a.purpose),
    emotion: str(a.emotion),
    intensity: Math.min(1, Math.max(0, num(a.intensity, 0.5))),
  }));
  const characters = list(t.characters).map((c) => ({
    id: str(c.id),
    description: str(c.description),
    promise: str(c.promise),
    intention: str(c.intention),
  }));
  const cast = new Set(characters.map((c) => c.id));
  const shots: StoryShot[] = list(t.shots).map((s, i) => {
    const id = i + 1;
    if (Number(s.id ?? id) !== id) throw new StoryError(`shots are numbered 1 to n in order (shot ${i + 1} says ${String(s.id)})`);
    const characterIds = list(s.characters).map(String);
    for (const c of characterIds) if (!cast.has(c)) throw new StoryError(`shot ${id}: character '${c}' is not in the cast`);
    const chain = s.chainFrom as Raw | undefined;
    if (chain && !(Number(chain.shot) >= 1 && Number(chain.shot) < id)) throw new StoryError(`shot ${id}: chainFrom names a shot before it`);
    return {
      id,
      slug: str(s.slug) || `shot-${id}`,
      seconds: num(s.seconds, 3),
      speed: num(s.speed, 1),
      beat: oneOf(s.beat ?? "journey", BEATS, `shot ${id}: beat`),
      purpose: str(s.purpose),
      characters: characterIds,
      action: str(s.action),
      intent: str(s.intent),
      gaze: str(s.gaze),
      physics: str(s.physics),
      interaction: str(s.interaction),
      ...(s.interactionKind ? { interactionKind: oneOf(s.interactionKind, INTERACTIONS, `shot ${id}: interactionKind`) } : {}),
      place: str(s.place),
      framing: str(s.framing),
      camera: str(s.camera),
      lens: str(s.lens),
      lighting: str(s.lighting),
      atmosphere: str(s.atmosphere),
      motion: str(s.motion),
      transition: str(s.transition) || "cut",
      ...(str(s.reuse) ? { reuse: str(s.reuse) } : {}),
      ...(chain ? { chainFrom: { shot: Number(chain.shot), ...(chain.at !== undefined ? { at: Number(chain.at) } : {}) } } : {}),
      sound: list(s.sound).map((c, k) => ({
        kind: oneOf(c.kind, SOUND_KINDS, `shot ${id}: sound[${k}].kind`),
        ...(c.at !== undefined && c.at !== null ? { at: num(c.at, 0) } : {}),
        gain: num(c.gain, -12),
      })),
    };
  });
  const ids = new Set(shots.map((s) => s.id));
  const lines = list(t.lines).map((l, i) => {
    const lineId = str(l.id) || `line-${i + 1}`;
    const on = list(l.shots).map(Number);
    if (on.length === 0 || on.some((s) => !ids.has(s))) throw new StoryError(`line ${lineId}: its shots must exist`);
    const d = (l.direction ?? {}) as Raw;
    const textByLanguage: Record<string, string> = {};
    for (const [k, v] of Object.entries(l)) if (/^[a-z]{2}$/.test(k) && typeof v === "string") textByLanguage[k] = str(v);
    return {
      id: lineId,
      shots: on,
      text: textByLanguage,
      direction: {
        emotion: str(d.emotion),
        pace: oneOf(d.pace ?? "measured", PACES, `line ${lineId}: pace`),
        emphasis: list(d.emphasis).map(String),
        pauseAfter: Math.max(0, num(d.pauseAfter, 0.3)),
      },
    };
  });
  const music = (t.music && typeof t.music === "object" ? t.music : { prompt: str(t.music) }) as Raw;
  const legal = (t.legal && typeof t.legal === "object" ? t.legal : {}) as Raw;
  return {
    title: str(t.title),
    references: list(t.references ?? legal.references).map((r) => ({ evokes: str(r.evokes), how: str(r.how) })),
    never: list(legal.never).map(String),
    logline: str(t.logline),
    theme: str(t.theme),
    arc,
    characters,
    lines,
    music: {
      prompt: str(music.prompt),
      cues: list(music.cues).map((c, i) => {
        const span = list(c.shots).map(Number);
        if (span.length && !(span.length === 2 && ids.has(span[0]) && ids.has(span[1]) && span[0] <= span[1])) {
          throw new StoryError(`music cue ${i + 1}: shots is [first, last] of existing shots`);
        }
        const beat = c.beat ?? (span.length ? shots[span[0] - 1].beat : undefined);
        return {
          beat: oneOf(beat, BEATS, `music cue ${i + 1}: beat`),
          ...(span.length ? { shots: [span[0], span[1]] as const } : {}),
          ...(str(c.genre) ? { genre: str(c.genre) } : {}),
          intensity: Math.min(1, Math.max(0, num(c.intensity, 0.5))),
          prompt: str(c.prompt),
        };
      }),
    },
    shots,
  };
}

// ── The rubric ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Verbs that say nothing about a character (the v1 film's failure): an action made only of these is flat. */
const GENERIC = /\b(moves?|moving|stands?|standing|looks? around|turns? (its|his|her) head (left|right)|flies around|is shown|appears?|idles?|poses?|walks? around|scanning)\b/gi;
/** Physical verbs of a living body: a character shot names at least one. */
const LIVING = /\b(breath\w*|lean\w*|crouch\w*|leap\w*|launch\w*|beat\w*|flap\w*|land\w*|fold\w*|grip\w*|tighten\w*|shuffl\w*|step\w*|nod\w*|bow\w*|nudg\w*|shak\w*|lift\w*|rais\w*|set\w*|tap\w*|push\w*|brac\w*|tumbl\w*|climb\w*|glanc\w*|snap\w*|puff\w*|smooth\w*|carr\w*|hold\w*|answer\w*|read\w*|recogn\w*|spread\w*|ruffl\w*|blink\w*|widen\w*|bump\w*|twirl\w*|hop\w*|spin\w*|wav(e|es|ing)|slid\w*|danc\w*|jump\w*|cheer\w*|scoop\w*|wrap\w*|flick\w*|sink\w*|shiver\w*|curl\w*|dive\w*|snatch\w*|catch\w*|bob\w*|bank\w*)\b/i;
/** Words too common to tie an action to a promise. */
const STOP = new Set(["the", "and", "with", "that", "this", "from", "into", "every", "each", "comes", "first", "time", "line", "open", "its", "their", "then", "they", "when", "what", "keeps", "keep", "follows"]);

const stems = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );

export interface Finding {
  readonly rule:
    | "arc" | "purpose" | "flat" | "off-topic" | "alive" | "continuity" | "voice" | "music" | "sound"
    | "interaction" | "lineup" | "rhythm" | "legal";
  readonly shot?: number;
  readonly line?: string;
  readonly message: string;
}

export interface Critique {
  /** Each criterion, 0..1 (1: every shot, line or cue passes it). */
  readonly scores: Readonly<
    Record<"arc" | "purpose" | "alive" | "onTopic" | "continuity" | "voice" | "music" | "sound" | "interaction" | "rhythm" | "legal", number>
  >;
  readonly findings: readonly Finding[];
  readonly pass: boolean;
}

/** A story with a cast shows at least this many kinds of interaction, in at least this share of its character shots. */
export const MIN_INTERACTION_KINDS = 3;
export const MIN_INTERACTION_SHARE = 1 / 3;
/** Rhythm: the spread of shot lengths (coefficient of variation), and what a quick shot is. */
export const MIN_LENGTH_SPREAD = 0.15;
export const QUICK_SHOT = 3;
const LINEUP = /\b(in a row|line[sd]? up|lineup|turns? (their|its) heads? (to|toward) the (camera|lens)|looks? (in)?to the (camera|lens)|pose[sd]? for)\b/i;

/**
 * Names a film must never say or show (the hard legal rule of orazaka#289): real people, songs, games, shows and brands
 * a brief may evoke. A treatment adds its own (`legal.never`); a reference is evoked through original or generic means,
 * never named. Matched as whole words, case-insensitive.
 */
export const NEVER_NAMED = [
  "snoop", "dr. dre", "kendrick", "drake", "sugar sammy", "bougon", "not like us", "gta", "grand theft auto",
  "rockstar games", "disney", "pixar", "marvel", "nintendo", "pokemon", "taylor swift", "beyonce", "eminem",
] as const;

function textsOf(story: Story): Array<[string, string]> {
  const out: Array<[string, string]> = [["title", story.title], ["logline", story.logline], ["theme", story.theme]];
  for (const l of story.lines) for (const [lang, t] of Object.entries(l.text)) out.push([`line ${l.id} ${lang}`, t]);
  for (const s of story.shots) {
    for (const k of ["action", "motion", "purpose", "intent", "interaction", "place", "camera", "lighting", "atmosphere"] as const) out.push([`shot ${s.id} ${k}`, s[k]]);
  }
  out.push(["music", story.music.prompt], ...story.music.cues.map((c, i): [string, string] => [`cue ${i + 1}`, c.prompt]));
  for (const r of story.references) out.push([`reference ${r.evokes}`, `${r.evokes} ${r.how}`]);
  return out;
}

/** What a story names that it must not (pure): the built-in list and the treatment's own, as whole words. */
export function legalFindings(story: Story): Finding[] {
  const banned = [...NEVER_NAMED, ...story.never].map((n) => n.toLowerCase().trim()).filter(Boolean);
  const findings: Finding[] = [];
  for (const [where, text] of textsOf(story)) {
    const lower = ` ${text.toLowerCase()} `;
    for (const name of banned) {
      const at = lower.search(new RegExp(`[^a-z0-9]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`));
      if (at >= 0) findings.push({ rule: "legal", message: `${where} names « ${name} »: evoke it through an original or generic means instead` });
    }
  }
  for (const r of story.references) {
    if (r.how.split(/\s+/).length < 3) findings.push({ rule: "legal", message: `the reference « ${r.evokes} » does not say how it is evoked legally` });
  }
  return findings;
}

/** Each criterion must reach this score; any finding of an arc, flat or off-topic beat fails the story outright. */
export const RUBRIC_THRESHOLD = 0.85;
/** A narrator speaks at most this many words a second of the shots a line is said over (calm, cinematic pace). */
export const MAX_WORDS_PER_SECOND = 2.6;
/** The score may never reach full loudness: a cue's intensity is at most this (« far too aggressive », orazaka#289). */
export const MAX_MUSIC_INTENSITY = 0.85;

const screen = (s: StoryShot): number => s.seconds / (s.speed || 1);

/** The rubric over a story (pure): the same rules the LLM judge reads, decided without one. */
export function critiqueStory(story: Story, language = "en"): Critique {
  const findings: Finding[] = [];
  const ratio = (passed: number, total: number): number => (total === 0 ? 1 : Number((passed / total).toFixed(3)));

  // Arc: every beat, in order, with a turn after the first third; the film ends on its payoff.
  const order = story.shots.map((s) => BEATS.indexOf(s.beat));
  const runtime = story.shots.reduce((sum, s) => sum + screen(s), 0);
  let arcOk = 0;
  for (const beat of BEATS) {
    if (story.shots.some((s) => s.beat === beat)) arcOk += 1;
    else findings.push({ rule: "arc", message: `the story has no ${beat}` });
  }
  if (order.some((b, i) => i > 0 && b < order[i - 1])) findings.push({ rule: "arc", message: "the beats go back in time (hook → journey → turn → payoff)" });
  const turnAt = story.shots.findIndex((s) => s.beat === "turn");
  if (turnAt >= 0) {
    const before = story.shots.slice(0, turnAt).reduce((sum, s) => sum + screen(s), 0);
    if (before < runtime / 3) findings.push({ rule: "arc", message: "the turn comes before the story has started its journey (first third)" });
  }
  if (!story.theme) findings.push({ rule: "arc", message: "the story names no theme" });

  // Purpose: every shot says why it is in the film.
  const purposeful = story.shots.filter((s) => {
    if (s.purpose.split(" ").length >= 4) return true;
    findings.push({ rule: "purpose", shot: s.id, message: "the shot has no purpose (why is it in the film?)" });
    return false;
  }).length;

  // Alive, flat and on-topic: what a character shot must have.
  const characterShots = story.shots.filter((s) => s.characters.length > 0 && !s.reuse);
  let alive = 0;
  let onTopic = 0;
  for (const s of characterShots) {
    const beats = s.action.split(/[,;]| then | and then /).filter((p) => p.trim().length > 3).length;
    const generic = (s.action.match(GENERIC) ?? []).length;
    const living = LIVING.test(`${s.action} ${s.physics}`);
    const problems: string[] = [];
    if (!s.intent) problems.push("no intention");
    if (!s.gaze) problems.push("no gaze");
    if (!s.physics) problems.push("no physics (weight, wings, breath)");
    if (!living) problems.push("no physical verb of a living body");
    if (beats < 2) problems.push("one action only (a beat needs a change)");
    if (problems.length === 0) alive += 1;
    else findings.push({ rule: "alive", shot: s.id, message: problems.join(", ") });
    if (generic > 0 && beats - generic < 2) findings.push({ rule: "flat", shot: s.id, message: `the action is generic motion (${(s.action.match(GENERIC) ?? []).join(", ")})` });
    // On topic: the action carries the promise or the intention of at least one character in it, or the purpose names it.
    const doing = stems(`${s.action} ${s.intent}`);
    const tied = s.characters.some((id) => {
      const c = story.characters.find((x) => x.id === id);
      if (!c) return false;
      const promise = stems(`${c.promise} ${c.intention}`);
      return [...promise].some((w) => doing.has(w)) || (c.promise && s.purpose.toLowerCase().includes(c.promise.split(/[:,]/)[0].toLowerCase()));
    });
    if (tied) onTopic += 1;
    else findings.push({ rule: "off-topic", shot: s.id, message: "the action serves no character's promise or intention" });
  }

  // Continuity: a chained shot keeps one of the characters of the shot it starts from.
  let chained = 0;
  let chainOk = 0;
  for (const s of story.shots) {
    if (!s.chainFrom) continue;
    chained += 1;
    const from = story.shots.find((x) => x.id === s.chainFrom?.shot);
    if (from && s.characters.some((c) => from.characters.includes(c))) chainOk += 1;
    else findings.push({ rule: "continuity", shot: s.id, message: `chained from shot ${s.chainFrom.shot} but shares no character with it` });
  }

  // Voice: every line has a direction, fits its shots, and lines never overlap.
  let voiceOk = 0;
  let lastShot = 0;
  for (const l of story.lines) {
    const words = (l.text[language] ?? Object.values(l.text)[0] ?? "").split(/\s+/).filter(Boolean).length;
    const seconds = l.shots.reduce((sum, id) => sum + screen(story.shots[id - 1]), 0);
    const problems: string[] = [];
    if (!l.direction.emotion) problems.push("no emotion");
    if (words / Math.max(seconds, 0.1) > MAX_WORDS_PER_SECOND) problems.push(`${words} words over ${seconds.toFixed(1)} s is rushed`);
    if (l.shots.some((id, k) => k > 0 && id !== l.shots[k - 1] + 1)) problems.push("its shots are not consecutive");
    if (l.shots[0] <= lastShot) problems.push("it overlaps the line before it");
    lastShot = l.shots[l.shots.length - 1];
    if (problems.length === 0) voiceOk += 1;
    else findings.push({ rule: "voice", line: l.id, message: problems.join(", ") });
  }

  // Music: a cue per beat present, never at full loudness, quiet in, the turn its peak, a resolve after it.
  const cue = (b: Beat): MusicCue | undefined => story.music.cues.find((c) => c.beat === b);
  let musicOk = 0;
  const musicChecks = 4;
  const byShots = story.music.cues.some((c) => c.shots);
  const covered = byShots
    ? story.shots.every((s) => story.music.cues.some((c) => c.shots && c.shots[0] <= s.id && s.id <= c.shots[1]))
    : BEATS.every((b) => !story.shots.some((s) => s.beat === b) || cue(b));
  if (covered) musicOk += 1;
  else findings.push({ rule: "music", message: byShots ? "a shot of the story has no music cue" : "a beat of the story has no music cue" });
  if (story.music.cues.every((c) => c.intensity <= MAX_MUSIC_INTENSITY)) musicOk += 1;
  else findings.push({ rule: "music", message: `a cue is louder than ${MAX_MUSIC_INTENSITY} (the score sits under the story)` });
  const [hook, turn, payoff] = [cue("hook"), cue("turn"), cue("payoff")];
  if (!hook || story.music.cues.every((c) => c.intensity >= hook.intensity)) musicOk += 1;
  else findings.push({ rule: "music", message: "the hook's cue is not the quietest (an intro starts low)" });
  // A score resolves: its last cue sits under its peak (a finale may peak — a DJ moment — then an outro brings it down).
  const peak = Math.max(...story.music.cues.map((c) => c.intensity), 0);
  const last = story.music.cues[story.music.cues.length - 1];
  void turn;
  void payoff;
  if (!last || story.music.cues.length < 2 || last.intensity <= peak - 0.1) musicOk += 1;
  else findings.push({ rule: "music", message: "the score ends at its peak (a score resolves after its peak)" });

  // Sound: every shot has a sound; a character shot has at least one event (its action is heard, not just a bed).
  const soundOk = story.shots.filter((s) => {
    const events = s.sound.filter((c) => c.at !== undefined).length;
    if (s.sound.length === 0) findings.push({ rule: "sound", shot: s.id, message: "the shot is silent (no sound list)" });
    else if (s.characters.length > 0 && !s.reuse && events === 0) findings.push({ rule: "sound", shot: s.id, message: "the character's action is not heard (no foley event)" });
    else return true;
    return false;
  }).length;

  // Interaction (orazaka#289: « they look presented, not part of a story »): characters meet, help, argue, hand off.
  const multi = characterShots.filter((s) => s.characters.length >= 2);
  const interacting = characterShots.filter((s) => s.characters.length >= 2 && s.interactionKind);
  const kinds = new Set(interacting.map((s) => s.interactionKind));
  const castSize = new Set(story.shots.flatMap((s) => s.characters)).size;
  let interactionScore = 1;
  if (castSize >= 2) {
    const share = characterShots.length ? interacting.length / characterShots.length : 0;
    interactionScore = Number((Math.min(1, kinds.size / MIN_INTERACTION_KINDS) * Math.min(1, share / MIN_INTERACTION_SHARE)).toFixed(3));
    if (kinds.size < MIN_INTERACTION_KINDS) {
      findings.push({ rule: "interaction", message: `the characters only ${[...kinds].join(", ") || "stand side by side"}: they should meet, help, argue, hand off (${MIN_INTERACTION_KINDS} kinds at least)` });
    }
    if (share < MIN_INTERACTION_SHARE) {
      findings.push({ rule: "interaction", message: `${interacting.length} of ${characterShots.length} character shots show characters acting on each other (a third at least)` });
    }
    for (const s of multi) if (!s.interactionKind) findings.push({ rule: "interaction", shot: s.id, message: "several characters share the frame but do nothing to each other" });
  }
  // A lineup: characters presented to the camera instead of acting (v1's « five on the ridge turn their heads to us »).
  for (const s of story.shots.filter((x) => x.characters.length >= 3 && !x.reuse)) {
    if (LINEUP.test(s.action) && !s.interactionKind) findings.push({ rule: "lineup", shot: s.id, message: "the characters are lined up for the camera, not acting" });
  }
  // Rhythm: shot lengths that vary, and somewhere a run of quick cuts (dynamism).
  const lengths = story.shots.map(screen);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const spread = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lengths.length)) / Math.max(mean, 1e-6);
  const quickRun = lengths.some((_, i) => i + 2 < lengths.length && lengths.slice(i, i + 3).every((x) => x <= QUICK_SHOT));
  let rhythmOk = 0;
  if (spread >= MIN_LENGTH_SPREAD) rhythmOk += 1;
  else findings.push({ rule: "rhythm", message: `every shot lasts about the same (spread ${spread.toFixed(2)}): change the rhythm` });
  if (quickRun || story.shots.length < 6) rhythmOk += 1;
  else findings.push({ rule: "rhythm", message: `no run of quick cuts (three shots of ${QUICK_SHOT} s or less): nothing has momentum` });
  // Legal (the hard rule): no real person, song, game, show or brand named anywhere; every reference says how it is evoked.
  const named = legalFindings(story);
  findings.push(...named);

  const scores = {
    arc: ratio(arcOk, BEATS.length) * (findings.some((f) => f.rule === "arc") ? 0.5 : 1),
    purpose: ratio(purposeful, story.shots.length),
    alive: ratio(alive, characterShots.length),
    onTopic: ratio(onTopic, characterShots.length),
    continuity: ratio(chainOk, chained),
    voice: ratio(voiceOk, story.lines.length),
    music: ratio(musicOk, musicChecks),
    sound: ratio(soundOk, story.shots.length),
    interaction: interactionScore,
    rhythm: ratio(rhythmOk, 2),
    legal: named.length ? 0 : 1,
  };
  const blocking = findings.some((f) => ["arc", "flat", "off-topic", "lineup", "legal"].includes(f.rule));
  return { scores, findings, pass: !blocking && Object.values(scores).every((v) => v >= RUBRIC_THRESHOLD) };
}

// ── The language-model judge ────────────────────────────────────────────────────────────────────────────────────────

/** The axes the judge scores, 1 to 5: what a director would ask of a story before a GPU second is paid. */
export const JUDGE_AXES = ["transport", "arc", "characters", "alive", "onTopic", "continuity"] as const;
export type JudgeAxis = (typeof JUDGE_AXES)[number];

export interface Judgement {
  readonly scores: Readonly<Record<JudgeAxis, number>>;
  /** Shots the judge rejects, with why (a flat beat, an action off the character's promise…). */
  readonly rejects: ReadonlyArray<{ readonly shot: number; readonly why: string }>;
  readonly notes: string;
}

/** The judge must give each axis at least this (out of 5) for the story to be filmed. */
export const JUDGE_THRESHOLD = 3.5;

/** The prompt of the critique Studio (pure): the story, compact, and the rubric it is scored against. */
export function judgePrompt(story: Story, language = "en"): string {
  const shots = story.shots
    .map((s) => `${s.id}. [${s.beat}] ${s.characters.join("+") || "landscape"} — purpose: ${s.purpose} — action: ${s.action}${s.gaze ? ` — gaze: ${s.gaze}` : ""}`)
    .join("\n");
  const cast = story.characters.map((c) => `${c.id}: promise «${c.promise}», intention «${c.intention}»`).join("\n");
  const lines = story.lines.map((l) => `(${l.shots.join(",")}) ${l.text[language] ?? ""} [${l.direction.emotion}, ${l.direction.pace}]`).join("\n");
  return [
    "You are a demanding film director reviewing a short film's treatment before it is shot. Judge it against this rubric.",
    "transport: does the story carry the viewer (a hook that raises a question, stakes, an emotional turn, a payoff that answers the hook)?",
    "arc: hook → journey → turn → payoff, in that order, each beat earned.",
    "characters: does each character want something that comes from its promise, and do the characters act on each other (meet, help, argue, hand off) instead of being presented in a lineup? Is each role clear from what it does?",
    "rhythm and emotion (part of transport): do the pace and the music change with the places and the beats, with real emotional moments?",
    "alive: does every character shot direct a living performance (gesture, gaze, breath, weight, wings, interaction), not generic motion?",
    "onTopic: does every action serve the beat and the character's promise (no decorative or unrelated action)?",
    "continuity: do shots follow each other in space and time (screen direction, the same props, the same weather)?",
    "Reject every shot whose action is flat (generic motion, nothing changes) or off-topic.",
    'Answer with ONE JSON object and nothing else: {"scores": {"transport": 1-5, "arc": 1-5, "characters": 1-5, "alive": 1-5, "onTopic": 1-5, "continuity": 1-5}, "rejects": [{"shot": n, "why": "…"}], "notes": "the two changes that would most improve it"}',
    "",
    `TITLE: ${story.title}`,
    `LOGLINE: ${story.logline}`,
    `THEME: ${story.theme}`,
    `CAST:\n${cast}`,
    `SHOTS:\n${shots}`,
    `NARRATION:\n${lines}`,
  ].join("\n");
}

/** The judge's answer, read once (pure): scores clamped to 1..5, rejects kept only for shots that exist. */
export function parseJudge(raw: string, shotCount: number): Judgement {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new StoryError("the judge's answer holds no JSON object");
  let data: Raw;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Raw;
  } catch (error: unknown) {
    throw new StoryError(`the judge's answer is not JSON (${error instanceof Error ? error.message : "parse error"})`);
  }
  const given = (data.scores ?? {}) as Raw;
  const scores = Object.fromEntries(JUDGE_AXES.map((a) => [a, Math.min(5, Math.max(1, num(given[a], 1)))])) as Record<JudgeAxis, number>;
  const rejects = list(data.rejects)
    .map((r) => ({ shot: Number(r.shot), why: str(r.why) }))
    .filter((r) => Number.isInteger(r.shot) && r.shot >= 1 && r.shot <= shotCount);
  return { scores, rejects, notes: str(data.notes) };
}

export interface Verdict {
  readonly pass: boolean;
  readonly reasons: readonly string[];
  /** What the next treatment run is told to fix (the critique fed back into the writer). */
  readonly notes: string;
}

/** The rubric and the judge together: a story is filmed only when both accept it (pure). */
export function verdict(rubric: Critique, judge?: Judgement): Verdict {
  const reasons = rubric.findings.map((f) => `${f.rule}${f.shot ? ` (shot ${f.shot})` : f.line ? ` (line ${f.line})` : ""}: ${f.message}`);
  if (judge) {
    for (const axis of JUDGE_AXES) if (judge.scores[axis] < JUDGE_THRESHOLD) reasons.push(`judge: ${axis} ${judge.scores[axis]}/5`);
    for (const r of judge.rejects) reasons.push(`judge rejects shot ${r.shot}: ${r.why}`);
  }
  const judged = !judge || (JUDGE_AXES.every((a) => judge.scores[a] >= JUDGE_THRESHOLD) && judge.rejects.length === 0);
  return { pass: rubric.pass && judged, reasons, notes: [...reasons, judge?.notes ?? ""].filter(Boolean).join("\n") };
}

// ── The timeline: lines, music and sound placed on the cut ─────────────────────────────────────────────────────────

/** When a line starts after its first shot's cut (a beat to let the picture land), in seconds. */
export const LINE_LEAD = 0.35;
/** A line may run over its last shot's cut by at most this (the voice can carry across a cut, briefly). */
export const LINE_SPILL = 0.4;

export interface Placed {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface Timeline {
  /** Each shot's place in the cut: [start, end) in seconds. */
  readonly shots: ReadonlyArray<{ readonly id: number; readonly start: number; readonly end: number; readonly beat: Beat }>;
  /** Each line, with where it is said and whether its measured length fits its shots. */
  readonly lines: ReadonlyArray<Placed & { readonly fits: boolean; readonly room: number }>;
  /** The music cues on the cut: each beat's span and its intensity. */
  readonly music: ReadonlyArray<Placed & { readonly intensity: number }>;
  /** Every sound of the sound list at its absolute time (beds span their shot). */
  readonly sound: ReadonlyArray<{ readonly shot: number; readonly kind: SoundKind; readonly start: number; readonly end: number; readonly gain: number }>;
  readonly seconds: number;
}

/**
 * The film's timeline (pure). `spans` are the shots' places in the cut when the edit is known (after snapping to the
 * music); otherwise each shot's screen time back to back. `voice` is each line's measured length in seconds (from the
 * voice step); a line without one is given the time its words take at the pace asked.
 */
export function timeline(story: Story, language = "en", voice: Readonly<Record<string, number>> = {}, spans?: ReadonlyArray<readonly [number, number]>): Timeline {
  let t = 0;
  const shots = story.shots.map((s, i) => {
    const [start, end] = spans?.[i] ?? [t, t + screen(s)];
    t = end;
    return { id: s.id, start: round(start), end: round(end), beat: s.beat };
  });
  const seconds = shots.length ? shots[shots.length - 1].end : 0;
  const wps: Record<Pace, number> = { slow: 1.9, measured: 2.3, rhythmic: 2.4, lively: 2.7 };
  const lines = story.lines.map((l) => {
    const first = shots[l.shots[0] - 1];
    const last = shots[l.shots[l.shots.length - 1] - 1];
    const words = (l.text[language] ?? "").split(/\s+/).filter(Boolean).length;
    const length = voice[l.id] ?? words / wps[l.direction.pace];
    const start = first.start + LINE_LEAD;
    const end = start + length;
    const room = last.end + LINE_SPILL - end;
    return { id: l.id, start: round(start), end: round(end), fits: room >= 0, room: round(room) };
  });
  // Cues that name their shots follow the place (a genre per city); the others follow their beat.
  const music = story.music.cues.some((c) => c.shots)
    ? story.music.cues
        .filter((c) => c.shots)
        .map((c, i) => ({ id: c.genre ? `${i + 1}-${c.genre}` : `${i + 1}-${c.beat}`, start: shots[c.shots![0] - 1].start, end: shots[c.shots![1] - 1].end, intensity: c.intensity }))
    : BEATS.flatMap((b) => {
        const inBeat = shots.filter((s) => s.beat === b);
        const cue = story.music.cues.find((c) => c.beat === b);
        if (!inBeat.length || !cue) return [];
        return [{ id: b, start: inBeat[0].start, end: inBeat[inBeat.length - 1].end, intensity: cue.intensity }];
      });
  const sound = story.shots.flatMap((s, i) =>
    s.sound.map((c) => {
      const shot = shots[i];
      const start = c.at === undefined ? shot.start : Math.min(shot.end, shot.start + c.at / (s.speed || 1));
      return { shot: s.id, kind: c.kind, start: round(start), end: c.at === undefined ? shot.end : round(start), gain: c.gain };
    }),
  );
  return { shots, lines, music, sound, seconds: round(seconds) };
}

const round = (v: number): number => Number(v.toFixed(3));

// ── The directed motion of a shot ───────────────────────────────────────────────────────────────────────────────────

/**
 * The motion prompt of a shot written from its parts when the treatment gives none (pure): who, what they want, the
 * action as a sequence, where they look, the physics of the body, the camera and the light — said positively (a
 * distilled video model ignores negatives). A living performance is directed, never left to « the bird moves ».
 */
export function directedMotion(story: Story, shot: StoryShot): string {
  if (shot.motion) return shot.motion;
  const who = shot.characters
    .map((id) => story.characters.find((c) => c.id === id)?.description)
    .filter(Boolean)
    .join(" and ");
  const parts = [
    who ? `${capital(who)}.` : "",
    shot.intent ? `Intention: ${shot.intent}.` : "",
    shot.action ? `${capital(shot.action.replace(/;\s*/g, ", then "))}.` : "",
    shot.gaze ? `Gaze: ${shot.gaze}.` : "",
    shot.physics ? `Physical detail: ${shot.physics}.` : "",
    shot.interaction ? `Together: ${shot.interaction}.` : "",
    [shot.camera, shot.lens].filter(Boolean).join(", ") + (shot.camera || shot.lens ? "." : ""),
    [shot.lighting, shot.atmosphere].filter(Boolean).join(", ") + (shot.lighting || shot.atmosphere ? "." : ""),
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
