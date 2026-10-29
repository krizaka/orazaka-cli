/**
 * @file cinema.director.ts
 * @description The director of a cinematic short (ADR-080): it walks the production file step by step and makes each
 * step an ordinary Studio run — script, character references, keyframes, shots, cut, voice-over, sound — saving the
 * file after every run, so a stopped production resumes where it stopped and a rejected shot is the only one paid again.
 *
 * It talks to the platform through a port (a fake in the tests, the REST API in the CLI).
 */

import {
  type Critique,
  type Judgement,
  type Story,
  type Verdict,
  critiqueStory,
  judgePrompt,
  parseJudge,
  parseStory,
  verdict,
} from "./cinema.story";
import {
  KEYFRAME_NEGATIVE,
  extractJson,
  type Production,
  type RunRecord,
  RunState,
  ScriptError,
  type ShotState,
  characterPrompt,
  editDecisionList,
  keyframePrompt,
  keyframeSize,
  motionPrompt,
  nextStep,
  parseScript,
  seedFor,
} from "./cinema.production";

/** What a finished Studio run tells the director: its state, its first output, the platform's own timing. */
export interface FinishedRun {
  readonly id: string;
  readonly status: string;
  readonly outputs: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly startedAt?: string;
  readonly finishedAt?: string | null;
  readonly errorMessage?: string | null;
}

export interface StudioPort {
  /** Starts a run of a Studio by key and follows it to its end. */
  run(studioKey: string, inputs: Record<string, unknown>): Promise<FinishedRun>;
  /** Turns an output of an earlier run (an image URL) into an uploaded asset id a video run can start from. */
  reupload(output: string, lastFrame: boolean, at?: number): Promise<string>;
}

export interface DirectorOptions {
  readonly save: (production: Production) => void;
  readonly log: (line: string) => void;
  /** Stop after this many runs (a dry pass, or a budget): the production file keeps the rest for later. */
  readonly maxRuns?: number;
  /** The video model of the shots (the catalogue's name); a shot that names its own model keeps it. */
  readonly videoModel?: string;
  /**
   * Makes the reference sheet of a character that has a reference render (a brand's own drawing): the sheet is uploaded
   * as it is, never redrawn by an image model. Absent: such a character is drawn from its description like any other.
   */
  readonly reference?: (characterId: string) => Promise<RunRecord>;
}

const SECONDS = (run: FinishedRun): number | undefined =>
  run.startedAt && run.finishedAt
    ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)
    : undefined;

function recordOf(studioKey: string, run: FinishedRun, seed?: number, key?: string): RunRecord {
  const output = key ? run.outputs.find((o) => o.key === key) : run.outputs[0];
  return {
    runId: run.id,
    studioKey,
    status: run.status,
    output: output?.value,
    seconds: SECONDS(run),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? undefined,
    error: run.status === RunState.Succeeded ? undefined : (run.errorMessage ?? `status ${run.status}`),
    seed,
  };
}

function shotState(production: Production, id: number): ShotState {
  let state = production.shots.find((s) => s.id === id);
  if (!state) {
    state = { id, attempt: 0 };
    production.shots.push(state);
  }
  return state;
}

/**
 * Runs the production until it is done, a run fails, or `maxRuns` is reached. Returns the production as saved.
 *
 * A failed run stops the director (the file says which and why): a person decides whether to resume it as it is or
 * change the brief. Nothing is retried blindly, because every retry is paid.
 */
export async function direct(production: Production, port: StudioPort, options: DirectorOptions): Promise<Production> {
  const model = options.videoModel ?? "wan2.2-i2v-a14b";
  let runs = 0;
  for (;;) {
    const step = nextStep(production);
    if (step.kind === "done") {
      options.log("production complete");
      return production;
    }
    if (options.maxRuns !== undefined && runs >= options.maxRuns) {
      options.log(`stopped after ${runs} run(s): resume with the same command`);
      return production;
    }
    runs += 1;
    const record = await runStep(production, step, port, model, options);
    production.history.push(record);
    options.save(production);
    options.log(
      `${step.kind}${"shot" in step ? ` ${step.shot}` : "id" in step ? ` ${step.id}` : ""}: ${record.status}` +
        `${record.seconds !== undefined ? ` in ${record.seconds}s` : ""} (run ${record.runId})${record.error ? ` — ${record.error}` : ""}`,
    );
    if (record.status !== RunState.Succeeded) return production;
  }
}

async function runStep(
  production: Production,
  step: ReturnType<typeof nextStep>,
  port: StudioPort,
  model: string,
  options: DirectorOptions,
): Promise<RunRecord> {
  const brief = production.brief;
  const script = production.script?.parsed;
  switch (step.kind) {
    case "script": {
      const run = await port.run("cinematic-script", {
        brief: brief.brief,
        format: brief.format,
        aspect: brief.aspect,
        durationSeconds: brief.durationSeconds,
        shots: brief.shots,
        language: brief.language,
        ...(brief.scriptModel ? { model: brief.scriptModel } : {}),
      });
      const record = recordOf("cinematic-script", run);
      if (run.status !== RunState.Succeeded || !record.output) {
        production.script = record;
        return record;
      }
      try {
        const parsed = parseScript(record.output, brief);
        production.script = { ...record, parsed };
        production.shots = parsed.shots.map((s) => ({ id: s.id, attempt: 0 }));
        return record;
      } catch (error: unknown) {
        // An answer the director cannot use is a failed step, said plainly: the next pass asks again.
        const failed = {
          ...record,
          status: RunState.Failed,
          error: error instanceof ScriptError ? error.message : String(error),
        };
        production.script = failed;
        return failed;
      }
    }
    case "character": {
      if (!script) throw new ScriptError("no script");
      const character = script.characters.find((c) => c.id === step.id);
      if (!character) throw new ScriptError(`no character ${step.id}`);
      if (character.reference && options.reference) {
        const sheet = await options.reference(character.id);
        production.characters[character.id] = sheet;
        return sheet;
      }
      const seed = seedFor(production, 0, 0, script.characters.indexOf(character) + 1);
      const run = await port.run("image-generation", {
        prompt: characterPrompt(script, character),
        size: keyframeSize(brief.aspect),
        negativePrompt: KEYFRAME_NEGATIVE,
        seed: String(seed),
      });
      const record = recordOf("image-generation", run, seed);
      production.characters[character.id] = record;
      return record;
    }
    case "keyframe": {
      if (!script) throw new ScriptError("no script");
      const shot = script.shots.find((s) => s.id === step.shot);
      if (!shot) throw new ScriptError(`no shot ${step.shot}`);
      const state = shotState(production, shot.id);
      const seed = seedFor(production, shot.id, state.attempt, 1);
      const run = await port.run("image-generation", {
        prompt: keyframePrompt(script, shot, brief.aspect),
        size: keyframeSize(brief.aspect),
        negativePrompt: KEYFRAME_NEGATIVE,
        seed: String(seed),
      });
      state.keyframe = recordOf("image-generation", run, seed);
      return state.keyframe;
    }
    case "video": {
      if (!script) throw new ScriptError("no script");
      const index = script.shots.findIndex((s) => s.id === step.shot);
      const shot = script.shots[index];
      const state = shotState(production, shot.id);
      // A continuous shot starts where the one before it ends (last-frame chaining); every other shot from its keyframe.
      // A shot chained from an earlier take (`chainFrom`) starts from a frame of that take.
      const fromId = shot.chainFrom ? shot.chainFrom.shot : index > 0 ? script.shots[index - 1].id : undefined;
      const previous = fromId !== undefined ? production.shots.find((s) => s.id === fromId) : undefined;
      const chained = shot.continuous || Boolean(shot.chainFrom);
      const source = chained ? previous?.video?.output : state.keyframe?.output;
      if (!source) throw new ScriptError(`shot ${shot.id} has nothing to start from`);
      const at = shot.chainFrom ? shot.chainFrom.at : shot.chainAt;
      const image = await port.reupload(source, chained, chained ? at : undefined);
      const seed = seedFor(production, shot.id, state.attempt, 2);
      const run = await port.run("video-generation", {
        prompt: motionPrompt(script, shot),
        durationSeconds: 5,
        aspect: brief.aspect,
        seed: String(seed),
        image,
        model: shot.model ?? model,
      });
      state.video = { ...recordOf("video-generation", run, seed), assetId: image };
      if (run.status === RunState.Succeeded) state.review = undefined;
      return state.video;
    }
    case "cut": {
      if (!script) throw new ScriptError("no script");
      const clips = script.shots.map((s) => production.shots.find((x) => x.id === s.id)?.video?.output ?? "");
      const run = await port.run("cinematic-cut", {
        clips,
        edit: JSON.stringify(editDecisionList(production, script)),
      });
      production.cut = recordOf("cinematic-cut", run);
      return production.cut;
    }
    case "voice": {
      if (!script) throw new ScriptError("no script");
      const run = await port.run("speech-synthesis", {
        text: script.voiceover,
        ...(brief.voice ? { voice: brief.voice } : {}),
        // Named, never the default: speech routes to it while its host answers, to the default otherwise.
        ...(brief.voiceModel ? { model: brief.voiceModel } : {}),
      });
      production.voice = recordOf("speech-synthesis", run);
      return production.voice;
    }
    case "sound": {
      if (!script || !production.cut?.output) throw new ScriptError("no cut to give sound to");
      const run = await port.run("video-sound", {
        video: production.cut.output,
        music: script.music,
        ...(production.voice?.output ? { voice: production.voice.output } : {}),
        seed: String(seedFor(production, 0, 0, 99)),
      });
      production.sound = recordOf("video-sound", run, undefined, "video");
      return production.sound;
    }
    default:
      options.log("nothing to do");
      throw new ScriptError("unknown step");
  }
}

// ── The treatment stage (orazaka#289): a brief becomes a story, judged before it becomes a shot list ────────────────

export interface TreatmentDraft {
  /** The treatment as the writer gave it (the JSON `orazaka cinema plan` reads). */
  readonly treatment: Record<string, unknown>;
  readonly story: Story;
  readonly rubric: Critique;
  readonly judge?: Judgement;
  readonly verdict: Verdict;
  /** Every run of the stage, in order: each writing pass and each judgement. */
  readonly runs: RunRecord[];
}

export interface TreatmentOptions {
  readonly brief: string;
  readonly language: "en" | "fr";
  readonly durationSeconds: number;
  readonly aspect: string;
  /** How many times the writer is asked again with the critique's notes before the stage gives up (default 2). */
  readonly revisions?: number;
  /** Skip the language-model judge (the rubric alone decides): a dry pass, or no chat model up. */
  readonly noJudge?: boolean;
  readonly model?: string;
  readonly log: (line: string) => void;
}

/**
 * Writes the treatment of a brief and has it judged (the rubric, then the LLM judge); a rejected draft goes back to the
 * writer with the reasons, at most `revisions` times. Every pass is an ordinary Studio run (metered, in the history).
 * Returns the last draft, accepted or not: the caller shows a rejected one to a person rather than filming it.
 */
export async function writeTreatment(port: StudioPort, options: TreatmentOptions): Promise<TreatmentDraft> {
  const runs: RunRecord[] = [];
  let notes = "";
  let last: TreatmentDraft | undefined;
  for (let pass = 0; pass <= (options.revisions ?? 2); pass += 1) {
    const written = await port.run("cinematic-treatment", {
      brief: options.brief,
      language: options.language,
      durationSeconds: options.durationSeconds,
      aspect: options.aspect,
      ...(notes ? { notes } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
    const record = recordOf("cinematic-treatment", written);
    runs.push(record);
    if (written.status !== RunState.Succeeded || !record.output)
      throw new ScriptError(`the treatment run ${written.id} did not succeed`);
    let treatment: Record<string, unknown>;
    let story: Story;
    try {
      treatment = extractJson(record.output) as Record<string, unknown>;
      story = parseStory(treatment);
    } catch (error: unknown) {
      notes = `Your last answer could not be read: ${error instanceof Error ? error.message : String(error)}. Answer with the JSON object only.`;
      options.log(`treatment pass ${pass + 1}: unreadable — asking again`);
      continue;
    }
    const rubric = critiqueStory(story, options.language);
    let judge: Judgement | undefined;
    if (!options.noJudge) {
      const judged = await port.run("cinematic-critique", {
        treatment: judgePrompt(story, options.language),
        ...(options.model ? { model: options.model } : {}),
      });
      const judgeRecord = recordOf("cinematic-critique", judged);
      runs.push(judgeRecord);
      if (judged.status === RunState.Succeeded && judgeRecord.output) {
        try {
          judge = parseJudge(judgeRecord.output, story.shots.length);
        } catch (error: unknown) {
          options.log(
            `judge: unreadable answer (${error instanceof Error ? error.message : String(error)}) — the rubric decides this pass`,
          );
        }
      }
    }
    const decided = verdict(rubric, judge);
    last = { treatment, story, rubric, judge, verdict: decided, runs };
    options.log(
      `treatment pass ${pass + 1}: ${decided.pass ? "accepted" : `rejected (${decided.reasons.length} reason(s))`}`,
    );
    if (decided.pass) return last;
    notes = decided.notes;
  }
  if (!last) throw new ScriptError("no readable treatment after every revision");
  return last;
}
