/**
 * @file cinema-staging.test.ts
 * @description The v3 gates of the cinema pack (orazaka#289, ADR-080 v3). Oussama's review of « le relais » and
 * « Orochia : la première livraison » named the anomalies a frame-by-frame audit confirmed: birds without contact shadows
 * or with shadows floating in the air, shadows against the light, birds floating beside the surface they should stand on,
 * wrong scale against the set, cut-out edges and flat cel birds on photographic plates, locked-off framings, motion that
 * slides like a sticker, colour and light that do not match the plate, props and costumes that change between shots,
 * a light burst that whites the frame out. Each one is a check here: on the treatment (staging, camera, cut), on each
 * keyframe and on each take (questions a local vision model answers, read strictly, and measured numbers).
 */

import {
  CAMERA_MOVES,
  FRAME_QUESTIONS,
  MAX_MEAN_SHOT_SECONDS,
  MAX_STATIC_SHARE,
  StagingError,
  critiqueCut,
  frameGate,
  measuredFindings,
  parseStaging,
  parseYesNo,
  questionsFor,
  scaleFinding,
} from "../services/cinema.staging";
import { SOUND_KINDS } from "../services/cinema.story";

type Raw = Record<string, unknown>;

const shot = (over: Raw = {}): Raw => ({
  slug: "pigeon-ledge",
  beats: 4,
  characters: ["pigeon"],
  camera: "handheld",
  angle: "low",
  light: { key: "left", hard: true },
  plate: "A wet rooftop ledge at night, hard key light from the left, shadows falling to the right.",
  staging: [{ character: "pigeon", support: "ground", surface: "the wet concrete ledge", scale: { ref: "the rooftop door", ratio: 0.2 } }],
  ...over,
});

const film = (shots: Raw[], over: Raw = {}): Raw => ({
  narration: "none",
  lines: [],
  score: { bpm: 140, prompt: "dark breakbeat", form: [{ section: "intro", bars: 4, feel: "sparse" }] },
  props: [{ id: "core", description: "a glowing cyan core the size of an apple" }],
  shots,
  ...over,
});

const kinetic = (n: number): Raw[] =>
  Array.from({ length: n }, (_, i) =>
    shot({ slug: `s${i + 1}`, beats: [2, 4, 2, 8, 1, 2][i % 6], camera: CAMERA_MOVES[i % 8], angle: i % 3 === 0 ? "low" : "eye" }),
  );

describe("the staging is read once and refused by name", () => {
  test("a character shot stages every character it shows, on a support", () => {
    expect(() => parseStaging(film([shot({ staging: [] })]))).toThrow(StagingError);
    expect(() => parseStaging(film([shot({ staging: [{ character: "pigeon", support: "levitating" }] })]))).toThrow(/support/);
  });

  test("a character on the ground names the surface it stands on and a scale reference", () => {
    expect(() => parseStaging(film([shot({ staging: [{ character: "pigeon", support: "ground", scale: { ref: "the door", ratio: 0.2 } }] })]))).toThrow(/surface/);
    expect(() => parseStaging(film([shot({ staging: [{ character: "pigeon", support: "ground", surface: "the ledge" }] })]))).toThrow(/scale/);
  });

  test("a camera move comes from the vocabulary; a light key from its directions", () => {
    expect(() => parseStaging(film([shot({ camera: "moves nicely" })]))).toThrow(/camera/);
    expect(() => parseStaging(film([shot({ light: { key: "somewhere" } })]))).toThrow(/light/);
  });

  test("a well staged film parses: beats become seconds at the tempo", () => {
    const parsed = parseStaging(film([shot()]));
    expect(parsed.shots[0].seconds).toBeCloseTo((4 * 60) / 140, 5);
    expect(parsed.shots[0].staging[0]).toMatchObject({ character: "pigeon", support: "ground", surface: "the wet concrete ledge" });
  });
});

describe("the cut: no narrator, on the beat, kinetic, varied", () => {
  test("a kinetic, beat-cut film without a narrator passes", () => {
    const c = critiqueCut(parseStaging(film(kinetic(24))));
    expect(c.findings).toEqual([]);
    expect(c.pass).toBe(true);
  });

  test("a narrator in a no-narration film is refused", () => {
    const c = critiqueCut(parseStaging(film(kinetic(24), { lines: [{ id: "l1", shots: [1], en: "Hello" }] })));
    expect(c.findings.map((f) => f.rule)).toContain("narrator");
    expect(c.pass).toBe(false);
  });

  test("locked-off framings: more than the allowed share is refused", () => {
    const shots = kinetic(20).map((s, i) => (i < 6 ? { ...s, camera: "locked" } : s));
    const c = critiqueCut(parseStaging(film(shots)));
    expect(6 / 20).toBeGreaterThan(MAX_STATIC_SHARE);
    expect(c.findings.map((f) => f.rule)).toContain("static");
  });

  test("slow cutting is refused: the mean shot is too long", () => {
    const shots = kinetic(12).map((s) => ({ ...s, beats: 8 }));
    const c = critiqueCut(parseStaging(film(shots)));
    expect((8 * 60) / 140).toBeGreaterThan(MAX_MEAN_SHOT_SECONDS);
    expect(c.findings.map((f) => f.rule)).toContain("pace");
  });

  test("one kind of camera move, or no low angle or macro, is monotonous", () => {
    const flat = kinetic(20).map((s) => ({ ...s, camera: "dolly-in", angle: "eye" }));
    const rules = critiqueCut(parseStaging(film(flat))).findings.map((f) => f.rule);
    expect(rules).toContain("camera");
    expect(rules).toContain("angle");
  });

  test("a plate that does not say where its hard key light comes from is refused (shadows against the light)", () => {
    const shots = kinetic(20).map((s, i) => (i === 3 ? { ...s, plate: "A rooftop at night." } : s));
    const c = critiqueCut(parseStaging(film(shots)));
    expect(c.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "light", shot: 4 })]));
  });
});

describe("frame questions: grounded, floating, on-model, continuity, sliding (calibrated)", () => {
  test("a grounded character is asked whether it touches its surface; a flyer is not", () => {
    const parsed = parseStaging(film([shot(), shot({ slug: "fly", staging: [{ character: "pigeon", support: "air" }] })]));
    const ground = questionsFor(parsed.shots[0], { pigeon: "the sky-blue pigeon" }).map((q) => q.check);
    const air = questionsFor(parsed.shots[1], { pigeon: "the sky-blue pigeon" }).map((q) => q.check);
    expect(ground).toEqual(["grounded", "floating"]);
    expect(air).toEqual(["floatingShadow"]);
  });

  test("the questions that did not discriminate on the calibration set are not asked", () => {
    expect(Object.keys(FRAME_QUESTIONS)).not.toContain("shadowDirection");
    expect(Object.keys(FRAME_QUESTIONS)).not.toContain("pasted");
  });

  test("the grounded question names the character and its surface; every question asks for YES or NO", () => {
    const parsed = parseStaging(film([shot()]));
    const q = questionsFor(parsed.shots[0], { pigeon: "the sky-blue pigeon" }).find((x) => x.check === "grounded");
    expect(q?.question).toContain("the sky-blue pigeon");
    expect(q?.question).toContain("the wet concrete ledge");
    for (const k of Object.values(FRAME_QUESTIONS)) expect(k.ask).toMatch(/Answer YES or NO only\.$/);
  });

  test("answers are read strictly: only the expected clear word passes", () => {
    expect(parseYesNo("YES", "YES")).toBe(true);
    expect(parseYesNo("No.", "NO")).toBe(true);
    expect(parseYesNo("Yes, but the shadow floats", "NO")).toBe(false);
    expect(parseYesNo("It is hard to tell", "YES")).toBe(false);
  });

  test("the gate rejects every file with a failed check and needs a person's review", () => {
    const results = [
      { file: "03-t0.png", check: "grounded" as const, pass: true },
      { file: "03-t0.png", check: "floating" as const, pass: true },
      { file: "05-t0.mp4", check: "sliding" as const, pass: false },
    ];
    const g = frameGate(results, { by: "director", at: "2026-10-21" });
    expect(g.rejected).toEqual(["05-t0.mp4"]);
    expect(g.pass).toBe(false);
    expect(frameGate(results.slice(0, 2)).pass).toBe(false);
    expect(frameGate(results.slice(0, 2), { by: "director", at: "2026-10-21" }).pass).toBe(true);
  });
});

describe("measured checks: scale, static camera, colour and light, white-out", () => {
  test("scale: the character's height against its reference must be near the asked ratio", () => {
    expect(scaleFinding({ character: 100, ref: 500 }, 0.2)).toBeUndefined();
    expect(scaleFinding({ character: 220, ref: 500 }, 0.2)).toMatch(/2\.2×/);
    expect(scaleFinding({ character: 40, ref: 500 }, 0.2)).toMatch(/0\.4×/);
  });

  test("a take whose camera does not move when the shot asks for a move is static", () => {
    const f = measuredFindings({ camera: "handheld" }, { cameraShift: 0.0004, zoom: 0.0 });
    expect(f.map((x) => x.check)).toContain("static");
    expect(measuredFindings({ camera: "locked" }, { cameraShift: 0.0, zoom: 0 })).toEqual([]);
    expect(measuredFindings({ camera: "dolly-in" }, { cameraShift: 0.0001, zoom: 0.02 })).toEqual([]);
  });

  test("a character much brighter or darker, or of another white balance, than the plate around it is refused", () => {
    expect(measuredFindings({ camera: "orbit" }, { lumaRatio: 1.9 }).map((x) => x.check)).toContain("colour");
    expect(measuredFindings({ camera: "orbit" }, { lumaRatio: 1.1, chromaShift: 22 }).map((x) => x.check)).toContain("colour");
    expect(measuredFindings({ camera: "orbit" }, { lumaRatio: 1.1, chromaShift: 5 })).toEqual([]);
  });

  test("a frame whited out for more than a moment is refused (the phoenix's burst)", () => {
    expect(measuredFindings({ camera: "orbit" }, { clippedSeconds: 0.6 }).map((x) => x.check)).toContain("whiteout");
    expect(measuredFindings({ camera: "orbit" }, { clippedSeconds: 0.1 })).toEqual([]);
  });
});

describe("the underground sounds (orazaka-worker-media app/foley.py v3)", () => {
  test("a treatment may ask for a tunnel, a crowd, a neon buzz, a train, a skateboard, sparks, an impact, a slide, a riser", () => {
    for (const k of ["tunnel", "crowd", "neon", "train", "skate", "sparks", "impact", "slide", "riser"]) expect(SOUND_KINDS).toContain(k);
  });
});
