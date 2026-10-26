/**
 * @file cinema.test.ts
 * @description A cinematic short (ADR-080): the script is checked once, the prompts carry the characters and the look,
 * the edit list fits the cut, a production resumes where it stopped, a reshoot redoes only what it must, and the
 * estimate is shown from the Studios' own credits and the measured times.
 */

import { type FinishedRun, type StudioPort, direct } from "../services/cinema.director";
import {
  type Brief,
  type Production,
  ScriptError,
  editDecisionList,
  estimate,
  extractJson,
  filmSeconds,
  keyframePrompt,
  markReshoot,
  motionPrompt,
  newProduction,
  nextStep,
  parseScript,
  seedFor,
} from "../services/cinema.production";

const BRIEF: Brief = {
  brief: "An original hero lands on a rooftop in a neon city at night",
  format: "superhero-vfx",
  aspect: "9:16",
  durationSeconds: 45,
  shots: 3,
  language: "en",
  seed: 1234,
};

const SCRIPT = {
  title: "Nightfall",
  logline: "A hero lands.",
  grade: "neon-night",
  style: "wet neon streets, magenta and teal, anamorphic 35mm.",
  characters: [{ id: "volt", description: "a woman in her thirties, short silver hair, matte-black armour with cyan seams" }],
  music: "dark synth, 120 bpm",
  ambience: "storm",
  voiceover: "The city sleeps. She does not.",
  titles: [{ text: "NIGHTFALL", start: 0.5, end: 2.5, style: "hero" }, { text: "late", start: 99, end: 100, style: "end" }],
  shots: [
    { id: 1, seconds: 5, characters: ["volt"], camera: "wide, slow push", action: "she stands", vfx: "", keyframe: "a figure on a rooftop", motion: "rain falls", transition: "dissolve", speed: 1, rampAt: null, caption: "" },
    { id: 2, seconds: 5, characters: ["volt", "ghost"], camera: "low angle", lens: "24", lighting: "cyan rim light", atmosphere: "rain", action: "she lands", vfx: "cyan shockwave", keyframe: "landing", motion: "she lands hard", transition: "flash", speed: 1, rampAt: 2, caption: "Impact" },
    { id: 3, seconds: 9, characters: [], camera: "close", action: "eyes glow", vfx: "", keyframe: "her eyes", motion: "eyes glow", transition: "spiral", speed: 0.5, rampAt: 3, caption: "", continuous: true },
    { id: 4, seconds: 5, characters: [], camera: "", action: "", vfx: "", keyframe: "beyond the asked count", motion: "", transition: "cut", speed: 1, rampAt: null, caption: "" },
  ],
};

describe("the script is parsed once", () => {
  test("an answer wrapped in prose or a code fence still yields its JSON", () => {
    expect(extractJson("Here it is:\n```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(() => extractJson("no json")).toThrow(ScriptError);
  });

  test("a missing comma between members or a trailing comma is repaired, never more", () => {
    expect(extractJson('{\n "a": "x"\n\n "b": [1, 2,],\n "c": {"d": 1}\n "e": true\n}')).toEqual({ a: "x", b: [1, 2], c: { d: 1 }, e: true });
    expect(() => extractJson('{"a": x}')).toThrow(ScriptError);
    expect(extractJson('{"v": "line one\nline two"}')).toEqual({ v: "line one line two" });
    expect(extractJson('{"lens": 35mm,\n "tempo": 68 BPM\n}')).toEqual({ lens: "35mm", tempo: "68 BPM" });
    expect(extractJson('{"style": "a 16:9 frame, 3:2 ratio"}')).toEqual({ style: "a 16:9 frame, 3:2 ratio" });
  });

  test("unknown values are corrected, the count is bounded, unknown characters dropped", () => {
    const script = parseScript(JSON.stringify(SCRIPT), BRIEF);
    expect(script.shots).toHaveLength(3);
    expect(script.shots[0].transition).toBe("cut"); // the first shot is entered by nothing
    expect(script.shots[2].transition).toBe("cut"); // "spiral" is not a transition of the cut
    expect(script.shots[1].characters).toEqual(["volt"]);
    // A model-written character id is a slug or it is dropped: it names a file on the operator's disk.
    const traversal = { ...SCRIPT, characters: [...SCRIPT.characters, { id: "../../evil", description: "a path" }] };
    expect(parseScript(JSON.stringify(traversal), BRIEF).characters.map((c) => c.id)).not.toContain("../../evil");
    expect(script.shots[2].seconds).toBe(5); // a 5-second clip cannot hold 9 seconds
    expect(script.shots[2].rampAt).toBeNull(); // no ramp inside a whole-shot slow motion
    expect(script.shots[1].rampAt).toBe(2);
    expect(script.shots[2].continuous).toBe(true);
    expect(script.grade).toBe("neon-night");
    expect(parseScript(JSON.stringify({ ...SCRIPT, title: "The **city** *breathes*" }), BRIEF).title).toBe("The city breathes");
    expect(parseScript(JSON.stringify({ ...SCRIPT, music: { genre: "synthwave", tempo: "120 bpm" } }), BRIEF).music).toBe("synthwave, 120 bpm");
  });

  test("a script without keyframes or shots is refused", () => {
    expect(() => parseScript(JSON.stringify({ shots: [{ keyframe: "" }, { keyframe: "x" }] }), BRIEF)).toThrow(/no keyframe/);
    expect(() => parseScript(JSON.stringify({ shots: [] }), BRIEF)).toThrow(/fewer than two/);
  });
});

describe("the prompts keep the look and the faces", () => {
  const script = parseScript(JSON.stringify(SCRIPT), BRIEF);

  test("a keyframe repeats each character's description and the visual bible, and asks for no text", () => {
    const prompt = keyframePrompt(script, script.shots[1], "9:16");
    expect(prompt).toContain("volt: a woman in her thirties, short silver hair");
    expect(prompt).toContain("magenta and teal");
    expect(prompt).toContain("vertical 9:16");
    expect(prompt).toContain("No text");
  });

  test("the cinematic kit: lens, light and air reach the keyframe and the shot", () => {
    for (const prompt of [keyframePrompt(script, script.shots[1], "9:16"), motionPrompt(script, script.shots[1])]) {
      expect(prompt).toContain("24mm lens");
      expect(prompt).toContain("lighting: cyan rim light");
      expect(prompt).toContain("atmosphere: rain");
    }
    expect(keyframePrompt(script, script.shots[1], "9:16")).toContain("anamorphic film look");
  });

  test("the motion prompt carries the effects and the move, never the word camera (it puts a camera in the frame)", () => {
    const prompt = motionPrompt(script, { ...script.shots[1], motion: "the camera follows her" });
    expect(prompt).toContain("cyan shockwave");
    expect(prompt).toContain("low angle");
    expect(prompt).not.toMatch(/camera/i);
  });

  test("seeds are reproducible and a reshoot changes them", () => {
    const p = newProduction(BRIEF);
    expect(seedFor(p, 2, 0)).toBe(seedFor(p, 2, 0));
    expect(seedFor(p, 2, 1)).not.toBe(seedFor(p, 2, 0));
  });
});

describe("the edit decision list fits the cut", () => {
  const production = newProduction(BRIEF);
  const script = parseScript(JSON.stringify(SCRIPT), BRIEF);
  const edit = editDecisionList(production, script) as {
    shots: Array<Record<string, unknown>>;
    upscale: string;
    ambience: string;
    sfx: boolean;
    titles: Array<Record<string, unknown>>;
    aspect: string;
    label: string;
  };

  test("each shot trims the clip's still head, ramps and transitions are kept, the label is set", () => {
    expect(edit.aspect).toBe("9:16");
    expect(edit.label).toBe("AI-generated");
    expect(edit).toMatchObject({ upscale: "seedvr2", ambience: "storm", sfx: true });
    expect(edit.shots[0]).toMatchObject({ clip: 0, in: 0.15, out: 5 });
    expect(edit.shots[1]).toMatchObject({ transition: "flash", transitionSeconds: 0.35, rampAt: 2.15, rampSpeed: 0.4 });
    expect(edit.shots[2]).toMatchObject({ speed: 0.5, zoom: 1 });
  });

  test("a title after the end of the film is dropped", () => {
    expect(edit.titles.map((t) => t.text)).toEqual(["NIGHTFALL"]);
  });

  test("the film's length counts slow motion and the overlaps", () => {
    // 5 + (2 + 3/0.4 - 0.35) + (5/0.5 - 1/30)
    expect(filmSeconds(script)).toBeCloseTo(5 + 2 + 7.5 - 0.35 + 10 - 1 / 30, 1);
  });
});

/** A platform that answers every run at once, as SUCCEEDED, recording what it was asked. */
function fakePort(failOn?: string): StudioPort & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let n = 0;
  return {
    calls,
    async run(studioKey, inputs): Promise<FinishedRun> {
      calls.push([studioKey, inputs]);
      n += 1;
      const failed = failOn !== undefined && studioKey === failOn;
      const value = studioKey === "cinematic-script" ? JSON.stringify(SCRIPT) : `/api/v1/assets/job-${n}/out`;
      return {
        id: `run-${n}`,
        status: failed ? "FAILED" : "SUCCEEDED",
        outputs: failed ? [] : [{ key: studioKey === "video-sound" ? "video" : "out", value }],
        startedAt: "2026-10-17T00:00:00Z",
        finishedAt: "2026-10-17T00:01:30Z",
        errorMessage: failed ? "worker down" : null,
      };
    },
    async reupload(output, lastFrame): Promise<string> {
      return `${lastFrame ? "last" : "key"}:${output}`;
    },
  };
}

describe("the director", () => {
  test("runs script, references, keyframes, shots, cut, voice and sound — each an ordinary Studio run", async () => {
    const port = fakePort();
    const saved: Production[] = [];
    const done = await direct(newProduction(BRIEF), port, { save: (p) => saved.push(p), log: () => undefined });
    expect(port.calls.map(([k]) => k)).toEqual([
      "cinematic-script",
      "image-generation", // the character reference, first
      "image-generation", // keyframe 1
      "image-generation", // keyframe 2 (shot 3 is continuous: it starts from shot 2's last frame)
      "video-generation",
      "video-generation",
      "video-generation",
      "cinematic-cut",
      "speech-synthesis",
      "video-sound",
    ]);
    expect(port.calls[6][1].image).toMatch(/^last:/);
    expect(port.calls[4][1].model).toBe("wan2.2-i2v-a14b");
    expect(JSON.parse(String(port.calls[7][1].edit)).shots).toHaveLength(3);
    expect(port.calls[9][1].voice).toBeDefined();
    expect(port.calls[8][1].model).toBeUndefined(); // no voice model named: the catalogue's default speaks
    expect(nextStep(done).kind).toBe("done");
    expect(done.history).toHaveLength(10);
    expect(done.history[0].seconds).toBe(90); // the platform's clock, not the director's
    expect(done.history[0]).toMatchObject({ startedAt: "2026-10-17T00:00:00Z", finishedAt: "2026-10-17T00:01:30Z" });
    expect(saved).toHaveLength(10); // saved after every run: a stop loses nothing
  });

  test("a named voice model is asked for by name", async () => {
    const port = fakePort();
    await direct(newProduction({ ...BRIEF, voiceModel: "kokoro-82m" }), port, { save: () => undefined, log: () => undefined });
    expect(port.calls.find(([k]) => k === "speech-synthesis")?.[1].model).toBe("kokoro-82m");
  });

  test("a failed run stops it, and the same command resumes there without paying twice", async () => {
    const first = fakePort("cinematic-cut");
    const stopped = await direct(newProduction(BRIEF), first, { save: () => undefined, log: () => undefined });
    expect(nextStep(stopped).kind).toBe("cut");
    const again = fakePort();
    await direct(stopped, again, { save: () => undefined, log: () => undefined });
    expect(again.calls.map(([k]) => k)).toEqual(["cinematic-cut", "speech-synthesis", "video-sound"]);
  });

  test("a reshoot redoes that shot, the shot chained to its last frame, the cut and the sound — nothing else", async () => {
    const made = await direct(newProduction(BRIEF), fakePort(), { save: () => undefined, log: () => undefined });
    markReshoot(made, [2]);
    const port = fakePort();
    await direct(made, port, { save: () => undefined, log: () => undefined });
    // Shot 3 is continuous: it started from shot 2's last frame, which the reshoot replaces (orazaka#259).
    expect(port.calls.map(([k]) => k)).toEqual(["video-generation", "video-generation", "cinematic-cut", "video-sound"]);
    expect(() => markReshoot(made, [9])).toThrow(/not in this production/);
  });

  test("maxRuns stops between runs", async () => {
    const port = fakePort();
    const p = await direct(newProduction(BRIEF), port, { save: () => undefined, log: () => undefined, maxRuns: 2 });
    expect(port.calls).toHaveLength(2);
    expect(nextStep(p).kind).toBe("keyframe");
  });
});

describe("the estimate, before anything runs", () => {
  const credits = { "cinematic-script": 40, "image-generation": 200, "video-generation": 3600, "cinematic-cut": 900, "speech-synthesis": 40, "video-sound": 900 };
  const measures = {
    script: { studioKey: "cinematic-script", seconds: 20, gpuUsd: 0 },
    character: { studioKey: "image-generation", seconds: 10, gpuUsd: 0.01 },
    keyframe: { studioKey: "image-generation", seconds: 10, gpuUsd: 0.01 },
    video: { studioKey: "video-generation", seconds: 100, gpuUsd: 0.11 },
    cut: { studioKey: "cinematic-cut", seconds: 120, gpuUsd: 0.13 },
    voice: { studioKey: "speech-synthesis", seconds: 5, gpuUsd: 0 },
    sound: { studioKey: "video-sound", seconds: 60, gpuUsd: 0.07 },
  };

  test("a new production counts every step from the brief", () => {
    const e = estimate(newProduction({ ...BRIEF, shots: 10 }), 10, credits, measures);
    const video = e.lines.find((l) => l.step === "video");
    expect(video).toMatchObject({ count: 10, credits: 36000, seconds: 1000, gpuUsd: 1.1 });
    expect(e.credits).toBe(40 + 2 * 200 + 10 * 200 + 36000 + 900 + 40 + 900);
  });

  test("what is done is not counted again", async () => {
    const made = await direct(newProduction(BRIEF), fakePort(), { save: () => undefined, log: () => undefined });
    expect(estimate(made, 3, credits, measures).credits).toBe(0);
    markReshoot(made, [1]);
    const e = estimate(made, 3, credits, measures);
    expect(e.lines.filter((l) => l.count > 0).map((l) => l.step)).toEqual(["video", "cut", "sound"]);
  });
});
