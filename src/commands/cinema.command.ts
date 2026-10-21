/**
 * @file cinema.command.ts
 * @description `orazaka cinema` — a cinematic short (30–60 s, 9:16 or 16:9) from a brief (ADR-080).
 *
 * A production is a folder holding `production.json`: the brief, the script's shot list, and every Studio run made
 * for it. Each step is an ordinary run — metered, policy-checked, in the run history — and the estimate is shown
 * before anything runs. A stopped production resumes with the same command; a rejected shot is reshot alone.
 *
 *   orazaka cinema new <dir> --brief "…" --format superhero-vfx --aspect 9:16 --duration 45 --shots 10
 *   orazaka cinema estimate <dir>
 *   orazaka cinema run <dir> [--yes] [--max-runs n]
 *   orazaka cinema fetch <dir>            keyframes, shots and the film, to look at them
 *   orazaka cinema reshoot <dir> 3,7 [--new-keyframe]
 *   orazaka cinema status <dir>
 *
 * A directed film (orazaka#259) starts from a treatment instead of a brief, and its shots can be made on a GPU host:
 *
 *   orazaka cinema plan <dir> --treatment treatment.json [--references renders/] [--language en]
 *   orazaka cinema sheet <dir>            the reference sheet of each character that has a reference render
 *   orazaka cinema jobs <dir> [--out f]   the pending shots, as jobs for a GPU host (the worker's own generator)
 *   orazaka cinema take <dir> 3 take.mp4  records a take made there (then: reshoot redoes it, and its chain)
 *   orazaka cinema review <dir> 3 take.mp4  a frame every 8 under the cast's reference sheet, to accept or reject it
 *
 * The treatment stage (orazaka#289) writes the story a short brief needs before any shot is planned, and judges it:
 *
 *   orazaka cinema treat <dir> --brief "…" [--revisions 2] [--no-judge]   story, arc, intentions, lines, cues, sound list
 *   orazaka cinema critique <treatment.json> [--judge]   the rubric (and the LLM judge) over a treatment: pass or why not
 *   orazaka cinema timeline <treatment.json> [--voice report.json]   every line, cue and sound placed on the cut
 *
 * The v3 gates (ADR-080 v3): staging, camera and cut, and the questions every keyframe and take must answer:
 *
 *   orazaka cinema stage <treatment.json> [--out questions.json]   the cut's findings, and the frame questions per shot
 */

import { Command } from "commander";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import { requireAuth } from "../threads";
import { Logger } from "../ui/logger";
import { ApiClient } from "../services/api-client";
import { StudioApi } from "../services/studio.api";
import { type FinishedRun, type StudioPort, direct, writeTreatment } from "../services/cinema.director";
import { FRAME_QUESTIONS, StagingError, critiqueCut, parseStaging, questionsFor } from "../services/cinema.staging";
import { StoryError, critiqueStory, judgePrompt, parseJudge, parseStory, timeline, verdict } from "../services/cinema.story";
import {
  ASPECTS,
  type Aspect,
  type Brief,
  FORMATS,
  type Format,
  type Production,
  type StepMeasure,
  estimate,
  markReshoot,
  newProduction,
  nextStep,
} from "../services/cinema.production";
import measured from "../services/cinema-estimate.json";
import { TreatmentError, planProduction, podJobs, recordTake, replan, reviewArgs, sheetArgs } from "../services/cinema.treatment";

const FILE = "production.json";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "REJECTED", "TIMED_OUT"]);
/** How often a run is asked for its state, and how long a single run is followed (the shot Studio's own timeout is 20 min). */
const POLL_MS = 10_000;
const RUN_LIMIT_MS = 45 * 60_000;

function load(dir: string): Production {
  const file = path.join(dir, FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} does not exist — start with: orazaka cinema new ${dir} --brief "…"`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Production;
}

function save(dir: string, production: Production): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), `${JSON.stringify(production, null, 2)}\n`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** An uploaded asset's id (a UUID), as `POST /api/v1/media/upload` answers it — not a URL to download. */
export const isAssetId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** How long a run waits for a free slot of the account's concurrent-run cap before the director gives up. */
const SLOT_WAIT_MS = 60 * 60_000;

/**
 * Starts a run, waiting while the account is at its concurrent-run cap ("too many concurrent runs"): a refusal that only
 * says "not now" is not a failed production. Any other refusal is thrown at once.
 */
export async function startWhenFree<T>(start: () => Promise<T>, wait = sleep, limitMs = SLOT_WAIT_MS, pollMs = 30_000): Promise<T> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    try {
      return await start();
    } catch (error: unknown) {
      // "Not now": the account is at its cap, or the platform is restarting (a 5xx while a deploy rolls out).
      const busy = error instanceof Error && /too many concurrent runs|internal server error|status 50\d|bad gateway|service unavailable/i.test(error.message);
      if (!busy || Date.now() + pollMs > deadline) throw error;
      await wait(pollMs);
    }
  }
}

/** The REST port: a run is started, then followed to its end; an output is re-uploaded as an asset a run can start from. */
const restPort: StudioPort = {
  async run(studioKey, inputs): Promise<FinishedRun> {
    const started = await startWhenFree(() => StudioApi.startStudioRun(studioKey, inputs));
    const deadline = Date.now() + RUN_LIMIT_MS;
    let run = started;
    while (!TERMINAL.has(run.status) && Date.now() < deadline) {
      await sleep(POLL_MS);
      try {
        run = await StudioApi.runDetail(started.id);
      } catch {
        // a network blip while following is not a failed run: ask again
      }
    }
    return run;
  },
  async reupload(output, lastFrame, at): Promise<string> {
    // Already an uploaded asset (a keyframe re-uploaded from the production folder): nothing to move.
    if (!lastFrame && isAssetId(output)) return output;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orz-cinema-"));
    try {
      const downloaded = path.join(scratch, lastFrame ? "clip.mp4" : "keyframe.png");
      await ApiClient.downloadTo(output, downloaded);
      let file = downloaded;
      if (lastFrame) {
        file = path.join(scratch, "last-frame.png");
        // The chained frame: a chosen second of the previous take (`chainAt`), else its last frame.
        const seek = at !== undefined ? ["-ss", at.toFixed(3)] : ["-sseof", "-0.15"];
        execFileSync("ffmpeg", ["-v", "error", "-y", ...seek, "-i", downloaded, "-update", "1", "-frames:v", "1", file]);
      }
      return (await ApiClient.uploadFile(file)).assetId;
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
};

async function creditsPerStudio(): Promise<Record<string, number>> {
  const keys = [...new Set(Object.values(measured.steps).map((s) => s.studioKey))];
  const credits: Record<string, number> = {};
  for (const key of keys) {
    try {
      credits[key] = (await StudioApi.detail(key)).estimatedCredits ?? 0;
    } catch {
      credits[key] = 0; // a Studio this deployment lacks is said by the run, not guessed here
    }
  }
  return credits;
}

async function printEstimate(production: Production): Promise<void> {
  const result = estimate(production, production.brief.shots, await creditsPerStudio(), measured.steps as Record<string, StepMeasure>);
  const rows = result.lines
    .filter((line) => line.count > 0)
    .map(
      (line) =>
        `  ${line.step.padEnd(10)} ${String(line.count).padStart(3)} run(s)  ${String(line.credits).padStart(7)} credits` +
        `  ~${String(line.seconds).padStart(5)} s` +
        (line.gpuUsd > 0 ? `  ~$${line.gpuUsd.toFixed(2)} GPU` : ""),
    );
  console.log(chalk.bold(`Estimate — a ${result.filmSeconds} s film (${production.brief.aspect})`));
  console.log(rows.join("\n"));
  console.log(
    `  ${"total".padEnd(10)}           ${String(result.credits).padStart(7)} credits  ~${Math.ceil(result.seconds / 60)} min` +
      (result.gpuUsd > 0 ? `  ~$${result.gpuUsd.toFixed(2)} GPU` : ""),
  );
  console.log(chalk.gray(`  times and GPU cost measured: ${measured.measured} (${measured.gpu}); credits: each Studio's own estimate`));
}

const newCommand = new Command("new")
  .description("Start a production from a brief")
  .argument("<dir>", "The production's folder")
  .requiredOption("-b, --brief <text>", "What the film is: story, place, mood (original characters only)")
  .option("-f, --format <format>", `One of ${FORMATS.join(", ")}`, "custom")
  .option("-a, --aspect <aspect>", "9:16 or 16:9", "9:16")
  .option("-d, --duration <seconds>", "30 to 60", "45")
  .option("-n, --shots <count>", "8 to 12", "10")
  .option("-l, --language <lang>", "en or fr", "en")
  .option("--seed <seed>", "The production's seed (every shot's seed derives from it)")
  .option("--voice <voice>", "A voice of the speech catalogue for the voice-over")
  .option("--voice-model <model>", "The speech model of the voice-over (e.g. kokoro-82m while a cinema GPU host runs)")
  .option("--script-model <model>", "The language model that writes the script (default: the catalogue's)")
  .action((dir: string, o: Record<string, string>) => {
    if (fs.existsSync(path.join(dir, FILE))) {
      Logger.error(`${dir} already holds a production`);
      process.exit(1);
    }
    if (!(FORMATS as readonly string[]).includes(o.format) || !(ASPECTS as readonly string[]).includes(o.aspect)) {
      Logger.error(`format must be one of ${FORMATS.join(", ")} and aspect one of ${ASPECTS.join(", ")}`);
      process.exit(1);
    }
    const brief: Brief = {
      brief: o.brief,
      format: o.format as Format,
      aspect: o.aspect as Aspect,
      durationSeconds: Math.min(60, Math.max(30, Number(o.duration) || 45)),
      shots: Math.min(12, Math.max(8, Number(o.shots) || 10)),
      language: o.language === "fr" ? "fr" : "en",
      seed: Number(o.seed) || Math.floor(Math.random() * 2_000_000_000),
      ...(o.voice ? { voice: o.voice } : {}),
      ...(o.scriptModel ? { scriptModel: o.scriptModel } : {}),
      ...(o.voiceModel ? { voiceModel: o.voiceModel } : {}),
    };
    save(dir, newProduction(brief));
    Logger.success(`production created in ${dir} — next: orazaka cinema estimate ${dir}`);
  });

const estimateCommand = new Command("estimate")
  .description("What the rest of the production will cost and take, before it runs")
  .argument("<dir>", "The production's folder")
  .action(async (dir: string) => {
    requireAuth();
    await printEstimate(load(dir));
  });

const runCommand = new Command("run")
  .description("Run (or resume) the production: script, references, keyframes, shots, cut, voice, sound")
  .argument("<dir>", "The production's folder")
  .option("-y, --yes", "Do not ask before spending")
  .option("--max-runs <n>", "Stop after this many runs (review in between)")
  .option("--model <name>", "The video model of the shots", "wan2.2-i2v-a14b")
  .action(async (dir: string, o: { yes?: boolean; maxRuns?: string; model: string }) => {
    requireAuth();
    const production = load(dir);
    await printEstimate(production);
    if (!o.yes) {
      const { confirm, isCancel } = await import("@clack/prompts");
      const go = await confirm({ message: "Start these runs?" });
      if (isCancel(go) || !go) {
        Logger.info("nothing was run");
        return;
      }
    }
    try {
      await direct(production, restPort, {
        save: (p) => save(dir, p),
        log: (line) => console.log(`${chalk.cyan("▸")} ${line}`),
        maxRuns: o.maxRuns ? Number(o.maxRuns) : undefined,
        videoModel: o.model,
        // A character drawn by its brand (a reference render) gets its sheet uploaded as its reference, never redrawn.
        reference: async (id) => {
          const character = production.script?.parsed?.characters.find((c) => c.id === id);
          if (!character?.reference) throw new TreatmentError(`character ${id} has no reference render`);
          const file = path.join(dir, "sheets", `${id}.png`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          execFileSync("ffmpeg", sheetArgs([character.reference], file));
          const { assetId } = await ApiClient.uploadFile(file);
          return { runId: `sheet:${id}`, studioKey: "reference-sheet", status: "SUCCEEDED", output: assetId, assetId };
        },
      });
    } catch (error: unknown) {
      Logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const next = nextStep(load(dir));
    Logger.info(next.kind === "done" ? `the film: ${load(dir).sound?.output}` : `next: ${next.kind}`);
  });

const fetchCommand = new Command("fetch")
  .description("Download the references, keyframes, shots and the film into the production's folder")
  .argument("<dir>", "The production's folder")
  .action(async (dir: string) => {
    requireAuth();
    const production = load(dir);
    const wanted: Array<[string | undefined, string]> = [
      ...Object.entries(production.characters).map(([id, r]): [string | undefined, string] => [r.output, `characters/${id}.png`]),
      ...production.shots.flatMap((s): Array<[string | undefined, string]> => [
        [s.keyframe?.output, `keyframes/shot-${String(s.id).padStart(2, "0")}.png`],
        [s.video?.output, `shots/shot-${String(s.id).padStart(2, "0")}.mp4`],
      ]),
      [production.cut?.output, "cut.mp4"],
      [production.voice?.output, "voice.wav"],
      [production.sound?.output, "film.mp4"],
    ];
    for (const [output, name] of wanted) {
      if (!output) continue;
      const bytes = await ApiClient.downloadTo(output, path.join(dir, name));
      console.log(`${name.padEnd(28)} ${(bytes / 1024).toFixed(0)} kB`);
    }
  });

const reshootCommand = new Command("reshoot")
  .description("Make shots again (a new seed): their video, then the cut and the sound")
  .argument("<dir>", "The production's folder")
  .argument("<shots>", "Shot numbers, comma-separated")
  .option("--new-keyframe", "Make the keyframe again too")
  .action((dir: string, shots: string, o: { newKeyframe?: boolean }) => {
    const ids = shots.split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
    save(dir, markReshoot(load(dir), ids, Boolean(o.newKeyframe)));
    Logger.success(`shots ${ids.join(", ")} will be made again — orazaka cinema run ${dir}`);
  });

const statusCommand = new Command("status")
  .description("Where the production is")
  .argument("<dir>", "The production's folder")
  .action((dir: string) => {
    const p = load(dir);
    const mark = (status?: string): string =>
      status === "SUCCEEDED" ? chalk.green("●") : status ? chalk.red("●") : chalk.gray("○");
    console.log(`${chalk.bold(p.script?.parsed?.title ?? "(no script yet)")} — ${p.brief.format}, ${p.brief.aspect}`);
    console.log(`${mark(p.script?.status)} script`);
    for (const [id, r] of Object.entries(p.characters)) console.log(`${mark(r.status)} character ${id}`);
    for (const s of p.shots) {
      console.log(`${mark(s.keyframe?.status)}${mark(s.video?.status)} shot ${s.id}${s.review === "reshoot" ? chalk.yellow(" (reshoot)") : ""}`);
    }
    console.log(`${mark(p.cut?.status)} cut  ${mark(p.voice?.status)} voice  ${mark(p.sound?.status)} sound`);
    console.log(chalk.gray(`next: ${nextStep(p).kind} · ${p.history.length} run(s) so far`));
  });

/** The render a character's `reference` names: a file as given, or `<name>-alpha.png` / `<name>.png` in the renders folder. */
function resolveReference(reference: string, renders?: string): string {
  const candidates = [reference, ...(renders ? [path.join(renders, `${reference}-alpha.png`), path.join(renders, `${reference}.png`)] : [])];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new TreatmentError(`no render for reference '${reference}' (looked for ${candidates.join(", ")})`);
  return path.resolve(found);
}

const planCommand = new Command("plan")
  .description("Start a production from a treatment (a directed shot list): no language model, every shot as written")
  .argument("<dir>", "The production's folder")
  .requiredOption("-t, --treatment <file>", "The treatment (JSON): cast, shots, lens, camera, light, model per shot")
  .option("-r, --references <dir>", "Where the characters' reference renders are (<name>-alpha.png)")
  .option("-l, --language <lang>", "en or fr (the captions)", "en")
  .option("--seed <seed>", "Overrides the treatment's seedBase")
  .option("--update", "The treatment changed: keep every shot already made, add the new ones")
  .action((dir: string, o: { treatment: string; references?: string; language: string; seed?: string; update?: boolean }) => {
    const exists = fs.existsSync(path.join(dir, FILE));
    if (exists !== Boolean(o.update)) {
      Logger.error(exists ? `${dir} already holds a production (--update to apply a changed treatment)` : `${dir} holds no production to update`);
      process.exit(1);
    }
    try {
      const raw = JSON.parse(fs.readFileSync(o.treatment, "utf-8")) as Record<string, unknown>;
      const characters = Array.isArray(raw.characters) ? (raw.characters as Array<Record<string, unknown>>) : [];
      raw.characters = characters.map((c) =>
        typeof c.reference === "string" && c.reference ? { ...c, reference: resolveReference(c.reference, o.references) } : c,
      );
      const options = { language: (o.language === "fr" ? "fr" : "en") as "en" | "fr", ...(o.seed ? { seed: Number(o.seed) } : {}) };
      const production = o.update ? replan(load(dir), raw, options) : planProduction(raw, options);
      save(dir, production);
      const script = production.script?.parsed;
      Logger.success(`${script?.title}: ${script?.shots.length} shots planned in ${dir} — next: orazaka cinema sheet ${dir}`);
    } catch (error: unknown) {
      Logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const sheetCommand = new Command("sheet")
  .description("Make the reference sheet of each character that has a reference render (kept as drawn, never redrawn)")
  .argument("<dir>", "The production's folder")
  .action((dir: string) => {
    const production = load(dir);
    const out = path.join(dir, "sheets");
    fs.mkdirSync(out, { recursive: true });
    for (const character of production.script?.parsed?.characters ?? []) {
      if (!character.reference) continue;
      const file = path.join(out, `${character.id}.png`);
      execFileSync("ffmpeg", sheetArgs([character.reference], file));
      production.characters[character.id] = { runId: `sheet:${character.id}`, studioKey: "reference-sheet", status: "SUCCEEDED", output: file };
      console.log(`${character.id.padEnd(12)} ${file}`);
    }
    save(dir, production);
  });

const jobsCommand = new Command("jobs")
  .description("The pending shots as jobs for a GPU host that runs the worker's own generator")
  .argument("<dir>", "The production's folder")
  .option("-o, --out <file>", "Write them to a file instead of printing them")
  .action((dir: string, o: { out?: string }) => {
    const jobs = podJobs(load(dir));
    const body = `${JSON.stringify(jobs, null, 2)}\n`;
    if (o.out) {
      fs.writeFileSync(o.out, body);
      Logger.success(`${jobs.length} job(s) in ${o.out}`);
    } else process.stdout.write(body);
  });

const takeCommand = new Command("take")
  .description("Record a take a GPU host made for a shot")
  .argument("<dir>", "The production's folder")
  .argument("<shot>", "The shot's number")
  .argument("<file>", "The take (mp4)")
  .option("--seconds <s>", "How long the host took to make it")
  .action((dir: string, shot: string, file: string, o: { seconds?: string }) => {
    save(dir, recordTake(load(dir), Number(shot), path.resolve(file), o.seconds ? Number(o.seconds) : undefined));
    Logger.success(`shot ${shot}: take recorded`);
  });

const reviewCommand = new Command("review")
  .description("A take's review sheet: a frame every 8 under the cast's reference sheet")
  .argument("<dir>", "The production's folder")
  .argument("<shot>", "The shot's number")
  .argument("<file>", "The take (mp4)")
  .action((dir: string, shot: string, file: string) => {
    const production = load(dir);
    const script = production.script?.parsed;
    const planned = script?.shots.find((s) => s.id === Number(shot));
    if (!script || !planned) {
      Logger.error(`shot ${shot} is not in this production`);
      process.exit(1);
    }
    const out = path.join(dir, "review");
    fs.mkdirSync(out, { recursive: true });
    const renders = planned.characters
      .map((id) => script.characters.find((c) => c.id === id)?.reference)
      .filter((r): r is string => Boolean(r))
      .slice(0, 5);
    const cast = path.join(out, `${path.basename(file, path.extname(file))}-cast.png`);
    // A shot without a cast (a landscape) is compared with its own first frame.
    if (renders.length > 0) execFileSync("ffmpeg", sheetArgs(renders, cast));
    else execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", cast]);
    const sheet = path.join(out, `${path.basename(file, path.extname(file))}.jpg`);
    execFileSync("ffmpeg", reviewArgs(file, cast, sheet));
    Logger.success(`review sheet: ${sheet}`);
  });


const treatCommand = new Command("treat")
  .description("Write the story of a brief (arc, intentions, purposeful shots, directed lines, music cues, sound list) and judge it")
  .argument("<dir>", "Where the treatment and its critique are written")
  .requiredOption("-b, --brief <text>", "The short brief (a sentence or two is enough)")
  .option("-l, --language <lang>", "en or fr", "en")
  .option("-d, --duration <s>", "Seconds of film", "60")
  .option("-a, --aspect <aspect>", "16:9 or 9:16", "16:9")
  .option("--revisions <n>", "How many times a rejected draft goes back to the writer", "2")
  .option("--no-judge", "The rubric alone decides (no language-model judge)")
  .option("--model <name>", "The chat model of the writer and the judge")
  .action(async (dir: string, o: { brief: string; language: string; duration: string; aspect: string; revisions: string; judge: boolean; model?: string }) => {
    requireAuth();
    try {
      const draft = await writeTreatment(restPort, {
        brief: o.brief,
        language: o.language === "fr" ? "fr" : "en",
        durationSeconds: Number(o.duration),
        aspect: o.aspect,
        revisions: Number(o.revisions),
        noJudge: !o.judge,
        model: o.model,
        log: (line) => console.log(`${chalk.cyan("▸")} ${line}`),
      });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "treatment.json"), `${JSON.stringify(draft.treatment, null, 1)}\n`);
      fs.writeFileSync(path.join(dir, "critique.json"), `${JSON.stringify({ rubric: draft.rubric, judge: draft.judge, verdict: draft.verdict, runs: draft.runs }, null, 1)}\n`);
      if (draft.verdict.pass) Logger.success(`accepted: ${path.join(dir, "treatment.json")} — next: orazaka cinema plan <prod> --treatment it`);
      else {
        Logger.warn(`not accepted after the revisions — read ${path.join(dir, "critique.json")}, edit the treatment, then: orazaka cinema critique`);
        process.exitCode = 2;
      }
    } catch (error: unknown) {
      Logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const critiqueCommand = new Command("critique")
  .description("Judge a treatment against the rubric (arc, purpose, alive, on-topic, continuity, voice, music, sound)")
  .argument("<treatment>", "The treatment (JSON)")
  .option("-l, --language <lang>", "en or fr", "en")
  .option("--judge", "Also ask the language-model judge (a cinematic-critique run)")
  .option("--model <name>", "The judge's chat model")
  .option("-o, --out <file>", "Write the critique (JSON) there")
  .action(async (file: string, o: { language: string; judge?: boolean; model?: string; out?: string }) => {
    try {
      const story = parseStory(JSON.parse(fs.readFileSync(file, "utf-8")));
      const rubric = critiqueStory(story, o.language);
      let judge;
      if (o.judge) {
        requireAuth();
        const run = await restPort.run("cinematic-critique", { treatment: judgePrompt(story, o.language), ...(o.model ? { model: o.model } : {}) });
        judge = parseJudge(run.outputs[0]?.value ?? "", story.shots.length);
      }
      const decided = verdict(rubric, judge);
      for (const [k, v] of Object.entries(rubric.scores)) console.log(`${k.padEnd(11)} ${v >= 0.85 ? chalk.green(v.toFixed(2)) : chalk.red(v.toFixed(2))}`);
      if (judge) for (const [k, v] of Object.entries(judge.scores)) console.log(`judge ${k.padEnd(11)} ${v}/5`);
      for (const r of decided.reasons) console.log(chalk.yellow(`  ${r}`));
      if (o.out) fs.writeFileSync(o.out, `${JSON.stringify({ rubric, judge, verdict: decided }, null, 1)}\n`);
      if (decided.pass) Logger.success("the story passes");
      else process.exitCode = 2;
    } catch (error: unknown) {
      Logger.error(error instanceof StoryError || error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const timelineCommand = new Command("timeline")
  .description("Place every line, music cue and sound of a treatment on the cut, and say which lines do not fit their shots")
  .argument("<treatment>", "The treatment (JSON)")
  .option("-l, --language <lang>", "en or fr", "en")
  .option("--voice <report>", "The voice step's report: [{id, seconds}] measured per line")
  .option("--spans <file>", "The cut's own shot spans ([[start, end], …], e.g. the worker's cut.timeline) instead of back to back")
  .action((file: string, o: { language: string; voice?: string; spans?: string }) => {
    const story = parseStory(JSON.parse(fs.readFileSync(file, "utf-8")));
    const measured: Record<string, number> = {};
    if (o.voice) for (const r of JSON.parse(fs.readFileSync(o.voice, "utf-8")) as Array<{ id: string; language?: string; seconds: number }>) {
      if (!r.language || r.language === o.language) measured[r.id] = r.seconds;
    }
    const spans = o.spans ? (JSON.parse(fs.readFileSync(o.spans, "utf-8")) as Array<[number, number]>) : undefined;
    const placed = timeline(story, o.language, measured, spans);
    process.stdout.write(`${JSON.stringify(placed, null, 1)}\n`);
    if (placed.lines.some((l) => !l.fits)) process.exitCode = 2;
  });

const stageCommand = new Command("stage")
  .description("Check a v3 treatment's staging, camera and cut, and write the questions every keyframe and take must answer")
  .argument("<treatment>", "The treatment (JSON, with score.bpm, beats, camera, angle, light and staging per shot)")
  .option("-o, --out <file>", "Write the frame questions (JSON: per shot, then the take questions) there")
  .action((file: string, o: { out?: string }) => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      const film = parseStaging(raw);
      const cut = critiqueCut(film);
      for (const f of cut.findings) console.log(chalk.yellow(`  ${f.rule}${f.shot ? ` (shot ${f.shot})` : ""}: ${f.message}`));
      const described = Object.fromEntries(
        ((raw.characters as Array<{ id: string; description: string }> | undefined) ?? []).map((c) => [c.id, `the ${c.description.split(",")[0]}`]),
      );
      const questions = {
        shots: film.shots.map((s) => ({ id: s.id, slug: s.slug, camera: s.camera, staging: s.staging, questions: questionsFor(s, described) })),
        take: { sliding: FRAME_QUESTIONS.sliding, onModel: FRAME_QUESTIONS.onModel, continuity: FRAME_QUESTIONS.continuity },
      };
      if (o.out) fs.writeFileSync(o.out, `${JSON.stringify(questions, null, 1)}\n`);
      if (cut.pass) Logger.success(`the cut passes: ${film.shots.length} shots at ${film.bpm} BPM`);
      else process.exitCode = 2;
    } catch (error: unknown) {
      Logger.error(error instanceof StagingError || error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

export const cinemaCommand = new Command("cinema")
  .description("A cinematic short (30–60 s) from a brief: script, keyframes, shots, cut, sound — each an ordinary Studio run")
  .addCommand(newCommand)
  .addCommand(estimateCommand)
  .addCommand(runCommand)
  .addCommand(fetchCommand)
  .addCommand(reshootCommand)
  .addCommand(statusCommand)
  .addCommand(planCommand)
  .addCommand(sheetCommand)
  .addCommand(jobsCommand)
  .addCommand(takeCommand)
  .addCommand(reviewCommand)
  .addCommand(treatCommand)
  .addCommand(critiqueCommand)
  .addCommand(timelineCommand)
  .addCommand(stageCommand);
