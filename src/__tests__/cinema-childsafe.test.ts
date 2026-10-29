/**
 * @file cinema-childsafe.test.ts
 * @description The hard rule of every brand film (orazaka#289, ADR-080 v2.8): no children, no child-like
 * figures, no dolls or toys — said in every plate, keyframe, character and shot prompt, and checked on the takes'
 * sampled frames by a vision model, then by a person. A take with one flagged frame is rejected; nothing passes unreviewed.
 */

import { CHILD_CHECK_PROMPT, childGate, parseChildCheck, sampleTimes } from "../services/cinema.childsafe";
import {
  type Brief,
  KEYFRAME_NEGATIVE,
  NO_CHILDREN,
  characterPrompt,
  keyframePrompt,
  motionPrompt,
  parseScript,
} from "../services/cinema.production";

const BRIEF: Brief = {
  brief: "A flamingo shares her first video",
  format: "custom",
  aspect: "16:9",
  durationSeconds: 10,
  shots: 2,
  language: "en",
  seed: 7,
};

const SCRIPT = {
  title: "Night",
  logline: "A flamingo shares her first video.",
  grade: "neon-night",
  style: "warm violet light, anamorphic 35mm.",
  characters: [{ id: "flamingo", description: "a pink cartoon flamingo with a long curved neck" }],
  shots: [
    {
      id: 1,
      keyframe: "A cosy bedroom studio at night",
      motion: "the flamingo taps a glowing orb",
      characters: ["flamingo"],
      seconds: 3,
      camera: "close",
      action: "she taps the orb",
      vfx: "",
      transition: "cut",
      speed: 1,
      rampAt: null,
      caption: "",
    },
    {
      id: 2,
      keyframe: "Rooftops under rain",
      motion: "the view drifts over the roofs",
      characters: [],
      seconds: 3,
      camera: "wide",
      action: "rain",
      vfx: "",
      transition: "cut",
      speed: 1,
      rampAt: null,
      caption: "",
    },
  ],
};

describe("every prompt carries the rule", () => {
  const script = parseScript(JSON.stringify(SCRIPT), BRIEF);

  test("the rule's words", () => {
    expect(NO_CHILDREN).toBe("No children, no child-like figures, no dolls or toys.");
  });

  test("keyframe, character and motion prompts say it — with and without a treatment's keep lines", () => {
    for (const shot of script.shots) {
      expect(keyframePrompt(script, shot, "16:9")).toContain(NO_CHILDREN);
      expect(motionPrompt(script, shot)).toContain(NO_CHILDREN);
    }
    expect(characterPrompt(script, script.characters[0])).toContain(NO_CHILDREN);
    const directed = { ...script, keep: "The characters keep their exact design.", keyframeKeep: "Same look." };
    expect(keyframePrompt(directed, script.shots[0], "16:9")).toContain(NO_CHILDREN);
    expect(motionPrompt(directed, script.shots[0])).toContain(NO_CHILDREN);
  });

  test("the negative prompt names them too", () => {
    for (const word of ["child", "children", "child-like figure", "doll", "toy"])
      expect(KEYFRAME_NEGATIVE).toContain(word);
  });
});

describe("the frame check", () => {
  test("frames are sampled across the whole take, ends included, at least six", () => {
    expect(sampleTimes(5, 6)).toEqual([0.05, 1.03, 2.01, 2.99, 3.97, 4.95]);
    expect(sampleTimes(2, 3)).toHaveLength(6);
  });

  test("the vision model is asked one question, yes or no", () => {
    expect(CHILD_CHECK_PROMPT).toBe(
      "Is there a doll or a human child anywhere in this image, even small or in the background? Answer YES or NO only.",
    );
  });

  test("an answer is read strictly: anything but a clear NO flags the frame", () => {
    expect(parseChildCheck("NO")).toEqual({ flagged: false, answer: "NO" });
    expect(parseChildCheck("no.")).toEqual({ flagged: false, answer: "NO" });
    expect(parseChildCheck("YES — a doll on the bed")).toEqual({ flagged: true, answer: "YES" });
    expect(parseChildCheck("I am not sure")).toEqual({ flagged: true, answer: "UNCLEAR" });
    expect(parseChildCheck("")).toEqual({ flagged: true, answer: "UNCLEAR" });
  });

  test("one flagged frame rejects its take; nothing passes without a person's review", () => {
    const frames = [
      { take: "02-flamingo-studio-t0.mp4", at: 1, flagged: false },
      { take: "03-flamingo-shares-t0.mp4", at: 0.05, flagged: false },
      { take: "03-flamingo-shares-t0.mp4", at: 2.4, flagged: true },
    ];
    expect(childGate(frames)).toEqual({
      pass: false,
      rejected: ["03-flamingo-shares-t0.mp4"],
      reviewed: false,
    });
    const clean = frames.filter((f) => !f.flagged);
    expect(childGate(clean)).toEqual({ pass: false, rejected: [], reviewed: false });
    expect(childGate(clean, { by: "Oussama", at: "2026-10-21" })).toEqual({ pass: true, rejected: [], reviewed: true });
    expect(childGate([], { by: "Oussama", at: "2026-10-21" }).pass).toBe(false);
  });
});
