/**
 * @file cinema.childsafe.ts
 * @description The hard rule of every brand film (orazaka#289, ADR-080 v2.8): no children, no child-like
 * figures, no dolls or toys. The prompts say it (NO_CHILDREN in cinema.production.ts); this module checks the takes.
 * Frames are sampled across each take (`sampleTimes`), a vision model answers one question per frame
 * (`CHILD_CHECK_PROMPT`, read strictly by `parseChildCheck`), and the gate (`childGate`) rejects every take with a
 * flagged frame and passes nothing a person has not reviewed. Pure: the caller runs the model and records the review.
 */

/**
 * The one question a vision model answers for each sampled frame. Measured on « la première livraison » with
 * Qwen2.5-VL 7B: it flags the doll keyframe and clears the clean ones; a longer question that excused the cartoon birds
 * let LLaVA 1.6 miss the doll (krizaka-ui tools/brand-films/dawn/childsafe.py runs it).
 */
export const CHILD_CHECK_PROMPT =
  "Is there a doll or a human child anywhere in this image, even small or in the background? Answer YES or NO only.";

/** The vision model the check was measured with (Apache-2.0, runs on a Mac through MLX). */
export const CHILD_CHECK_MODEL = "Qwen2.5-VL-7B-Instruct";

/** Frames sampled per take: never fewer than this, so a background object seen only for a moment is still seen. */
// @fixed: a floor of the check's coverage, not a business parameter.
const MIN_FRAMES = 6;
/** Seconds kept clear of a take's first and last frame (a seek there can land outside the stream). */
// @fixed: a margin for the frame grabber, a technical fact.
const EDGE = 0.05;

/** When to grab frames in a take of `seconds`: evenly from start to end, `count` frames or MIN_FRAMES. */
export function sampleTimes(seconds: number, count = MIN_FRAMES): number[] {
  const n = Math.max(MIN_FRAMES, count);
  const span = Math.max(0, seconds - 2 * EDGE);
  return Array.from({ length: n }, (_, i) => Number((EDGE + (span * i) / (n - 1)).toFixed(2)));
}

export interface ChildCheck {
  flagged: boolean;
  answer: "YES" | "NO" | "UNCLEAR";
}

/** Reads a model's answer strictly: only a clear NO clears the frame; YES or anything unclear flags it. */
export function parseChildCheck(raw: string): ChildCheck {
  const word = raw
    .trim()
    .toUpperCase()
    .match(/^(YES|NO)\b/)?.[1];
  if (word === "NO") return { flagged: false, answer: "NO" };
  if (word === "YES") return { flagged: true, answer: "YES" };
  return { flagged: true, answer: "UNCLEAR" };
}

export interface FrameResult {
  take: string;
  at: number;
  flagged: boolean;
}

export interface Review {
  by: string;
  at: string;
}

export interface ChildGate {
  pass: boolean;
  rejected: string[];
  reviewed: boolean;
}

/** The gate: every take with a flagged frame is rejected; it passes only with frames checked, none flagged, and a review. */
export function childGate(frames: readonly FrameResult[], review?: Review): ChildGate {
  const rejected = [...new Set(frames.filter((f) => f.flagged).map((f) => f.take))];
  const reviewed = Boolean(review?.by && review?.at);
  return { pass: frames.length > 0 && rejected.length === 0 && reviewed, rejected, reviewed };
}
