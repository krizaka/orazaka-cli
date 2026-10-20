/**
 * @file cinema-story.test.ts
 * @description The treatment stage of orazaka#289: a story is read once, the rubric rejects flat beats, off-topic action,
 * a missing turn, a rushed line or a loud score; the LLM judge's answer is read and combined with it; a rejected draft
 * goes back to the writer with the reasons; every line, cue and sound lands on the cut; a shot can start from any earlier
 * take and a kept take costs nothing.
 */

import { type FinishedRun, type StudioPort, writeTreatment } from "../services/cinema.director";
import { markReshoot } from "../services/cinema.production";
import {
  MAX_WORDS_PER_SECOND,
  StoryError,
  critiqueStory,
  directedMotion,
  judgePrompt,
  parseJudge,
  parseStory,
  timeline,
  verdict,
} from "../services/cinema.story";
import { planProduction, podJobs } from "../services/cinema.treatment";

type Raw = Record<string, unknown>;

const bird = (over: Raw = {}): Raw => ({
  slug: "pigeon-ledge",
  seconds: 3,
  beat: "hook",
  characters: ["pigeon"],
  purpose: "Meet the hero and the parcel it must carry.",
  intent: "the pigeon gathers its courage",
  gaze: "out at the storm, then down at its parcel",
  physics: "chest rising with one deep breath, feathers lifting in a gust",
  action: "the pigeon tightens its grip on the parcel, looks out at the storm, then shuffles to the edge",
  keyframe: "The pigeon on a ledge.",
  motion: "The pigeon breathes and shuffles to the edge.",
  sound: [{ kind: "rain", gain: -14 }, { kind: "steps", at: 2.2, gain: -20 }],
  ...over,
});

const land = (beat: string, over: Raw = {}): Raw => ({
  slug: `${beat}-land`,
  seconds: 3,
  beat,
  characters: [],
  purpose: `The ${beat} of the story, in the landscape.`,
  action: "the view glides over the valley",
  keyframe: "A valley.",
  motion: "The view glides.",
  sound: [{ kind: "wind", gain: -14 }],
  ...over,
});

const story = (over: Raw = {}): Raw => ({
  title: "Dawn",
  logline: "A pigeon carries a parcel through the storm.",
  theme: "No one carries a promise alone.",
  arc: [
    { beat: "hook", purpose: "a storm", emotion: "suspense", intensity: 0.3 },
    { beat: "journey", purpose: "help", emotion: "warmth", intensity: 0.5 },
    { beat: "turn", purpose: "the fall", emotion: "hope", intensity: 0.75 },
    { beat: "payoff", purpose: "dawn", emotion: "pride", intensity: 0.6 },
  ],
  characters: [
    { id: "pigeon", description: "the sky-blue pigeon", promise: "delivers, every time", intention: "carries the parcel to the door" },
    { id: "falcon", description: "the orange falcon", promise: "keeps watch: security comes first", intention: "never lets the pigeon out of its sight" },
  ],
  music: {
    prompt: "intimate score",
    cues: [
      { beat: "hook", intensity: 0.3, prompt: "dark intro" },
      { beat: "journey", intensity: 0.5, prompt: "warm" },
      { beat: "turn", intensity: 0.75, prompt: "build" },
      { beat: "payoff", intensity: 0.6, prompt: "resolve" },
    ],
  },
  lines: [
    { id: "storm", shots: [1], en: "The night the storm came.", fr: "La nuit de l'orage.", direction: { emotion: "hushed", pace: "slow", emphasis: ["storm"] } },
    { id: "falcon", shots: [3], en: "The falcon keeps watch.", fr: "Le faucon veille.", direction: { emotion: "calm", pace: "measured", emphasis: [] } },
  ],
  shots: [
    { id: 1, ...bird() },
    { id: 2, ...land("journey") },
    {
      id: 3,
      ...bird({
        slug: "falcon-watch",
        beat: "journey",
        characters: ["falcon"],
        purpose: "The falcon keeps watch over the pigeon's route.",
        intent: "the falcon locks onto the pigeon to watch over it",
        gaze: "snaps to the right toward the pigeon",
        physics: "leans into the wind, wings half-open to brace",
        action: "the falcon's head snaps to the right, it leans into the wind, then braces its wings and keeps watch",
      }),
    },
    { id: 4, ...land("turn") },
    { id: 5, ...bird({ slug: "pigeon-door", beat: "payoff", purpose: "The parcel arrives at dawn.", action: "the pigeon lands, sets the parcel down, then looks back", chainFrom: { shot: 1, at: 2 } }) },
  ],
  ...over,
});

describe("parseStory", () => {
  it("reads a story: its arc, cast, lines with direction, cues and sound list", () => {
    const s = parseStory(story());
    expect(s.shots).toHaveLength(5);
    expect(s.lines[0].direction).toEqual({ emotion: "hushed", pace: "slow", emphasis: ["storm"], pauseAfter: 0.3 });
    expect(s.shots[4].chainFrom).toEqual({ shot: 1, at: 2 });
    expect(s.shots[0].sound[1]).toEqual({ kind: "steps", at: 2.2, gain: -20 });
  });

  it("refuses by name what cannot be a story", () => {
    expect(() => parseStory(story({ arc: [{ beat: "climax" }] }))).toThrow(/arc\[0\].beat 'climax'/);
    expect(() => parseStory(story({ lines: [{ id: "x", shots: [9], en: "hi" }] }))).toThrow(/line x: its shots must exist/);
    const bad = story();
    (bad.shots as Raw[])[0].sound = [{ kind: "explosion" }];
    expect(() => parseStory(bad)).toThrow(/sound\[0\].kind 'explosion'/);
    const loop = story();
    (loop.shots as Raw[])[0].chainFrom = { shot: 1 };
    expect(() => parseStory(loop)).toThrow(/chainFrom names a shot before it/);
    const stranger = story();
    (stranger.shots as Raw[])[0].characters = ["owl"];
    expect(() => parseStory(stranger)).toThrow(/'owl' is not in the cast/);
  });
});

describe("critiqueStory — the rubric", () => {
  it("passes a story with an arc, purposeful living shots, directed lines, a resolving score and a sound for every shot", () => {
    const c = critiqueStory(parseStory(story()));
    expect(c.findings).toEqual([]);
    expect(c.pass).toBe(true);
    expect(Object.values(c.scores).every((v) => v === 1)).toBe(true);
  });

  it("rejects the v1 failure: generic motion, no intention, no gaze — flat and not alive", () => {
    const s = story();
    (s.shots as Raw[])[2] = {
      id: 3,
      ...bird({ characters: ["falcon"], beat: "journey", intent: "", gaze: "", physics: "", action: "the falcon stands on the cliff and turns its head left, then right, scanning the valley" }),
    };
    const c = critiqueStory(parseStory(s));
    expect(c.pass).toBe(false);
    expect(c.findings.map((f) => `${f.rule}:${f.shot}`)).toEqual(expect.arrayContaining(["alive:3", "flat:3"]));
  });

  it("rejects off-topic action: nothing of the character's promise or intention", () => {
    const s = story();
    (s.shots as Raw[])[2] = {
      id: 3,
      ...bird({ characters: ["falcon"], beat: "journey", purpose: "A pretty moment.", intent: "it enjoys the view", action: "the falcon lifts a flower, sniffs it, then smiles" }),
    };
    const c = critiqueStory(parseStory(s));
    expect(c.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "off-topic", shot: 3 })]));
    expect(c.pass).toBe(false);
  });

  it("rejects a story without a turn, or whose turn comes in its first third", () => {
    const s = story();
    (s.shots as Raw[])[3] = { id: 4, ...land("payoff") };
    expect(critiqueStory(parseStory(s)).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "arc", message: "the story has no turn" })]));
    const early = story();
    (early.shots as Raw[])[1] = { id: 2, ...land("turn") };
    (early.shots as Raw[])[2] = { ...(early.shots as Raw[])[2], beat: "turn" };
    const findings = critiqueStory(parseStory(early)).findings.map((f) => f.message);
    expect(findings).toEqual(expect.arrayContaining([expect.stringMatching(/turn comes before the story has started/)]));
  });

  it("refuses a rushed line, a loud score, a peak after the turn and a character whose action is not heard", () => {
    const s = story();
    const words = Math.ceil(MAX_WORDS_PER_SECOND * 3) + 3;
    (s.lines as Raw[])[0] = { id: "storm", shots: [1], en: Array(words).fill("word").join(" "), direction: { emotion: "hushed", pace: "slow" } };
    (s.music as Raw).cues = [
      { beat: "hook", intensity: 0.6, prompt: "loud" },
      { beat: "journey", intensity: 0.5, prompt: "warm" },
      { beat: "turn", intensity: 0.7, prompt: "build" },
      { beat: "payoff", intensity: 0.95, prompt: "huge" },
    ];
    (s.shots as Raw[])[0].sound = [{ kind: "rain", gain: -14 }];
    const rules = critiqueStory(parseStory(s)).findings.map((f) => `${f.rule}:${f.message}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^voice:.*rushed/),
        expect.stringMatching(/^music:.*louder than 0.85/),
        expect.stringMatching(/^music:.*hook's cue is not the quietest/),
        expect.stringMatching(/^music:.*payoff is louder than the turn/),
        expect.stringMatching(/^sound:.*not heard/),
      ]),
    );
  });

  it("checks continuity: a shot chained from another shares a character with it", () => {
    const s = story();
    (s.shots as Raw[])[4] = { ...(s.shots as Raw[])[4], chainFrom: { shot: 2 } };
    expect(critiqueStory(parseStory(s)).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "continuity", shot: 5 })]));
  });
});

describe("the language-model judge", () => {
  it("is asked the rubric's questions about every shot, line and promise", () => {
    const prompt = judgePrompt(parseStory(story()));
    for (const part of ["transport", "onTopic", "Reject every shot whose action is flat", "promise «delivers, every time»", "1. [hook] pigeon", "(3) The falcon keeps watch."]) {
      expect(prompt).toContain(part);
    }
  });

  it("reads its answer: scores clamped to 1..5, rejects of shots that exist only", () => {
    const j = parseJudge('Sure! {"scores": {"transport": 9, "arc": 4, "characters": 4, "alive": 0, "onTopic": 4}, "rejects": [{"shot": 3, "why": "flat"}, {"shot": 42, "why": "?"}], "notes": "more stakes"}', 5);
    expect(j.scores).toEqual({ transport: 5, arc: 4, characters: 4, alive: 1, onTopic: 4, continuity: 1 });
    expect(j.rejects).toEqual([{ shot: 3, why: "flat" }]);
    expect(() => parseJudge("no json here", 5)).toThrow(StoryError);
  });

  it("decides with the rubric: both must accept", () => {
    const rubric = critiqueStory(parseStory(story()));
    const good = { scores: { transport: 4, arc: 4, characters: 4, alive: 4, onTopic: 5, continuity: 4 }, rejects: [], notes: "" };
    expect(verdict(rubric, good).pass).toBe(true);
    expect(verdict(rubric).pass).toBe(true);
    const flat = verdict(rubric, { ...good, scores: { ...good.scores, transport: 2 }, rejects: [{ shot: 3, why: "generic" }] });
    expect(flat.pass).toBe(false);
    expect(flat.reasons).toEqual(["judge: transport 2/5", "judge rejects shot 3: generic"]);
  });
});

describe("timeline — lines, cues and sounds on the cut", () => {
  it("starts a line a beat after its first shot's cut and says whether its measured length fits", () => {
    const t = timeline(parseStory(story()), "en", { storm: 2.5, falcon: 4 });
    expect(t.shots.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 6], [6, 9], [9, 12], [12, 15]]);
    expect(t.lines).toEqual([
      { id: "storm", start: 0.35, end: 2.85, fits: true, room: 0.55 },
      { id: "falcon", start: 6.35, end: 10.35, fits: false, room: -0.95 },
    ]);
    expect(t.music.map((m) => [m.id, m.start, m.end, m.intensity])).toEqual([["hook", 0, 3, 0.3], ["journey", 3, 9, 0.5], ["turn", 9, 12, 0.75], ["payoff", 12, 15, 0.6]]);
    expect(t.sound.filter((x) => x.kind === "steps").map((x) => x.start)).toEqual([2.2, 8.2, 14.2]);
    expect(t.sound.find((x) => x.kind === "rain")).toMatchObject({ start: 0, end: 3 });
  });

  it("follows the edit's own spans when they are known (cuts snapped to the music)", () => {
    const spans = [[0, 3.2], [3.2, 6], [6, 9.4], [9.4, 12], [12, 15.5]] as const;
    expect(timeline(parseStory(story()), "fr", {}, spans).lines[1].start).toBe(6.35);
  });
});

describe("directedMotion", () => {
  it("writes a living performance from the parts when the treatment gives no motion", () => {
    const s = parseStory(story());
    const shot = { ...s.shots[2], motion: "" };
    const m = directedMotion(s, shot);
    expect(m).toMatch(/^The orange falcon\. Intention: the falcon locks onto the pigeon/);
    expect(m).toContain("Gaze: snaps to the right toward the pigeon.");
    expect(m).toContain("Physical detail: leans into the wind");
    expect(directedMotion(s, s.shots[0])).toBe("The pigeon breathes and shuffles to the edge.");
  });
});

describe("writeTreatment — written, judged, sent back with the reasons", () => {
  const ok = (id: string, value: string): FinishedRun => ({ id, status: "SUCCEEDED", outputs: [{ key: "out", value }] });

  it("rejects a flat draft, sends the reasons back to the writer, accepts the revised one", async () => {
    const flat = story();
    (flat.shots as Raw[])[2] = { id: 3, ...bird({ characters: ["falcon"], beat: "journey", intent: "", gaze: "", physics: "", action: "the falcon stands and looks around" }) };
    const calls: Array<{ key: string; inputs: Record<string, unknown> }> = [];
    const drafts = [JSON.stringify(flat), JSON.stringify(story())];
    const port: StudioPort = {
      run: async (key, inputs) => {
        calls.push({ key, inputs });
        if (key === "cinematic-treatment") return ok(`t${calls.length}`, drafts.shift() ?? "");
        return ok(`j${calls.length}`, JSON.stringify({ scores: { transport: 4, arc: 4, characters: 4, alive: 4, onTopic: 4, continuity: 4 }, rejects: [] }));
      },
      reupload: async () => "x",
    };
    const draft = await writeTreatment(port, { brief: "a pigeon in a storm", language: "en", durationSeconds: 60, aspect: "16:9", log: () => undefined });
    expect(draft.verdict.pass).toBe(true);
    expect(calls.map((c) => c.key)).toEqual(["cinematic-treatment", "cinematic-critique", "cinematic-treatment", "cinematic-critique"]);
    expect(String(calls[2].inputs.notes)).toMatch(/alive \(shot 3\)/);
    expect(draft.runs).toHaveLength(4);
  });

  it("asks again when the answer cannot be read, and gives back the last draft when every revision is rejected", async () => {
    const flat = story({ theme: "" });
    const answers = ["not json", JSON.stringify(flat), JSON.stringify(flat)];
    const port: StudioPort = { run: async (key) => ok(key, answers.shift() ?? ""), reupload: async () => "x" };
    const draft = await writeTreatment(port, { brief: "b", language: "en", durationSeconds: 60, aspect: "16:9", noJudge: true, revisions: 2, log: () => undefined });
    expect(draft.verdict.pass).toBe(false);
    expect(draft.verdict.reasons).toContain("arc: the story names no theme");
  });
});

describe("the planner: chained from any earlier take, kept takes", () => {
  const treatment = (): Raw => ({
    title: "Dawn",
    style: "Feature-film CG.",
    keep: "One single continuous shot.",
    characters: [{ id: "pigeon", description: "the pigeon" }],
    shots: [
      { id: 1, seconds: 3, characters: ["pigeon"], keyframe: "k1", motion: "m1", model: "wan2.2-i2v-a14b-hq" },
      { id: 2, seconds: 3, characters: [], reuse: "17-storm-valley-t0.mp4" },
      { id: 3, seconds: 3, characters: ["pigeon"], motion: "m3", chainFrom: { shot: 1, at: 1 } },
      { id: 4, seconds: 3, characters: ["pigeon"], motion: "m4", chainFrom: { shot: 3, at: 2.6 } },
    ],
  });

  it("starts a chained shot from a frame of the take it names, and never makes a kept take", () => {
    const p = planProduction(treatment(), { language: "en" });
    expect(p.shots[1].video?.output).toBe("17-storm-valley-t0.mp4");
    const jobs = podJobs(p);
    expect(jobs.map((j) => [j.shot, j.start])).toEqual([
      [1, { keyframe: 1 }],
      [3, { lastFrameOf: 1, at: 1 }],
      [4, { lastFrameOf: 3, at: 2.6 }],
    ]);
  });

  it("a reshoot redoes every shot chained from it, through the chain", () => {
    const p = planProduction(treatment(), { language: "en" });
    markReshoot(p, [1]);
    expect(p.shots.filter((s) => s.review === "reshoot").map((s) => s.id)).toEqual([1, 3, 4]);
  });

  it("refuses a chain to a later shot and a kept take with nothing", () => {
    const bad = treatment();
    (bad.shots as Raw[])[0] = { ...(bad.shots as Raw[])[0], chainFrom: { shot: 3 } };
    expect(() => planProduction(bad, { language: "en" })).toThrow(/chainFrom names a shot before it/);
  });
});
