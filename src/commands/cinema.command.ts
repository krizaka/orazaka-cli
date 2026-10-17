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
import { type FinishedRun, type StudioPort, direct } from "../services/cinema.director";
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
  async reupload(output, lastFrame): Promise<string> {
    // Already an uploaded asset (a keyframe re-uploaded from the production folder): nothing to move.
    if (!lastFrame && isAssetId(output)) return output;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orz-cinema-"));
    try {
      const downloaded = path.join(scratch, lastFrame ? "clip.mp4" : "keyframe.png");
      await ApiClient.downloadTo(output, downloaded);
      let file = downloaded;
      if (lastFrame) {
        file = path.join(scratch, "last-frame.png");
        execFileSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.15", "-i", downloaded, "-update", "1", "-frames:v", "1", file]);
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

export const cinemaCommand = new Command("cinema")
  .description("A cinematic short (30–60 s) from a brief: script, keyframes, shots, cut, sound — each an ordinary Studio run")
  .addCommand(newCommand)
  .addCommand(estimateCommand)
  .addCommand(runCommand)
  .addCommand(fetchCommand)
  .addCommand(reshootCommand)
  .addCommand(statusCommand);
