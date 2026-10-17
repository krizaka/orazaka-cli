/**
 * @file cinema.director.ts
 * @description The director of a cinematic short (ADR-080): it walks the production file step by step and makes each
 * step an ordinary Studio run — script, character references, keyframes, shots, cut, voice-over, sound — saving the
 * file after every run, so a stopped production resumes where it stopped and a rejected shot is the only one paid again.
 *
 * It talks to the platform through a port (a fake in the tests, the REST API in the CLI).
 */

import {
  KEYFRAME_NEGATIVE,
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
  reupload(output: string, lastFrame: boolean): Promise<string>;
}

export interface DirectorOptions {
  readonly save: (production: Production) => void;
  readonly log: (line: string) => void;
  /** Stop after this many runs (a dry pass, or a budget): the production file keeps the rest for later. */
  readonly maxRuns?: number;
  /** The video model of the shots (the catalogue's name). */
  readonly videoModel?: string;
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
        const failed = { ...record, status: RunState.Failed, error: error instanceof ScriptError ? error.message : String(error) };
        production.script = failed;
        return failed;
      }
    }
    case "character": {
      if (!script) throw new ScriptError("no script");
      const character = script.characters.find((c) => c.id === step.id);
      if (!character) throw new ScriptError(`no character ${step.id}`);
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
      const previous = index > 0 ? production.shots.find((s) => s.id === script.shots[index - 1].id) : undefined;
      const source = shot.continuous ? previous?.video?.output : state.keyframe?.output;
      if (!source) throw new ScriptError(`shot ${shot.id} has nothing to start from`);
      const image = await port.reupload(source, shot.continuous);
      const seed = seedFor(production, shot.id, state.attempt, 2);
      const run = await port.run("video-generation", {
        prompt: motionPrompt(script, shot),
        durationSeconds: 5,
        aspect: brief.aspect,
        seed: String(seed),
        image,
        model,
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
