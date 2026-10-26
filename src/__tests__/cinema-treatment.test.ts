/**
 * @file cinema-treatment.test.ts
 * @description The pieces orazaka#259 asked of the cinematic Studio: a treatment becomes a typed shot list without a
 * language model (the planner), a shot can name its own video model, a reshoot redoes the shots chained to it, the
 * pending shots export as jobs a GPU host runs, and the reference sheets and review sheets are ffmpeg graphs.
 */

import { type FinishedRun, type StudioPort, direct } from "../services/cinema.director";
import { type Production, markReshoot, motionPrompt, nextStep } from "../services/cinema.production";
import {
  TreatmentError,
  VIDEO_MODELS,
  planProduction,
  podJobs,
  recordTake,
  replan,
  ffmpegOperand,
  reviewArgs,
  sheetArgs,
} from "../services/cinema.treatment";

const treatment = (): Record<string, unknown> => ({
  title: "Dawn",
  logline: "The flock greets the dawn.",
  aspect: "16:9",
  grade: "teal-orange",
  style: "Feature-film CG.",
  music: "epic score, 90 bpm",
  ambience: "wind",
  seedBase: 2026102000,
  keep: "One single continuous shot. The characters keep their exact design.",
  keyframeKeep: "Keep every character's exact shape.",
  cues: { falcon: { en: "The falcon keeps watch: security comes first.", fr: "Le faucon veille : la sécurité d’abord." } },
  characters: [
    { id: "falcon", reference: "falcon", description: "the orange-red falcon with a black visor" },
    { id: "pigeon", reference: "pigeon", description: "the sky-blue pigeon with an orange parcel" },
  ],
  titles: [{ start: 1, end: 3, style: "hero", en: "The world of Krizaka.", fr: "Le monde de Krizaka." }],
  shots: [
    { id: 1, slug: "falcon-cliff", seconds: 5, characters: ["falcon"], model: "wan2.2-i2v-a14b-hq", lens: "35mm", camera: "slow orbit", lighting: "blue hour", atmosphere: "fog", action: "it scans", keyframe: "the falcon on a cliff", motion: "The falcon scans the valley. Slow orbit right, 35 mm.", transition: "cut", speed: 1, rampAt: null, caption: "falcon" },
    { id: 2, slug: "valley", seconds: 3, characters: [], model: "ltx-video-0.9.8-13b-distilled", lens: "24mm", camera: "aerial glide", lighting: "first light", atmosphere: "clouds", action: "glide", keyframe: "a valley before dawn", motion: "Aerial glide over the valley.", transition: "dissolve", speed: 1, rampAt: null },
    { id: 3, slug: "pigeon-takeoff", seconds: 2.67, characters: ["pigeon"], model: "wan2.2-i2v-a14b-hq", lens: "24mm", camera: "tilt up", lighting: "golden", atmosphere: "haze", action: "takes off", keyframe: "the pigeon on a roof", motion: "The pigeon takes off. Low angle, slow tilt up.", transition: "cut", speed: 1, rampAt: null },
    { id: 4, slug: "pigeon-flight", seconds: 2.67, characters: ["pigeon"], model: "wan2.2-i2v-a14b-hq", lens: "50mm", camera: "tracking", lighting: "golden", atmosphere: "clouds", action: "flies", keyframe: "the pigeon in flight", motion: "The pigeon flies fast. Fast tracking alongside.", transition: "cut", speed: 1, rampAt: null, continuous: true },
  ],
});

describe("the planner: a treatment is a typed shot list, checked once", () => {
  test("a treatment becomes a production whose script is already done, with its own seeds and per-shot models", () => {
    const p = planProduction(treatment(), { language: "en" });
    expect(p.brief.seed).toBe(2026102000);
    expect(p.brief.aspect).toBe("16:9");
    expect(p.script?.status).toBe("SUCCEEDED");
    expect(p.script?.studioKey).toBe("treatment");
    const script = p.script?.parsed;
    expect(script?.shots.map((s) => s.model)).toEqual(["wan2.2-i2v-a14b-hq", "ltx-video-0.9.8-13b-distilled", "wan2.2-i2v-a14b-hq", "wan2.2-i2v-a14b-hq"]);
    expect(script?.shots[0].caption).toBe("The falcon keeps watch: security comes first.");
    expect(planProduction(treatment(), { language: "fr" }).script?.parsed?.shots[0].caption).toBe("Le faucon veille : la sécurité d’abord.");
    expect(script?.shots[3].continuous).toBe(true);
    expect(script?.characters[0].reference).toBe("falcon");
    expect(script?.titles[0].text).toBe("The world of Krizaka.");
    expect(nextStep(p).kind).toBe("character"); // the reference sheets come first, then the keyframes
  });

  test("what a treatment gets wrong is refused by name, never guessed", () => {
    const bad = (patch: (t: Record<string, unknown>) => void, message: RegExp): void => {
      const t = treatment();
      patch(t);
      expect(() => planProduction(t, { language: "en" })).toThrow(TreatmentError);
      expect(() => planProduction(t, { language: "en" })).toThrow(message);
    };
    const shots = (t: Record<string, unknown>): Array<Record<string, unknown>> => t.shots as Array<Record<string, unknown>>;
    bad((t) => (shots(t)[1].model = "hunyuan-video"), /shot 2: model 'hunyuan-video' is not one of/);
    // A character id names a file on disk (`<dir>/sheets/<id>.png`): a path is refused, never written outside the folder.
    for (const id of ["../../.ssh/falcon", "/tmp/falcon", "a\\b", ".falcon"]) {
      bad((t) => ((t.characters as Array<Record<string, unknown>>)[0].id = id), /is not a slug/);
    }
    bad((t) => (shots(t)[0].characters = ["owl"]), /shot 1: character 'owl' is not in the cast/);
    bad((t) => (shots(t)[0].continuous = true), /shot 1 cannot continue a shot before it/);
    bad((t) => (shots(t)[2].seconds = 7), /shot 3: seconds must be between 1 and 5/);
    bad((t) => (shots(t)[2].transition = "spiral"), /shot 3: transition 'spiral'/);
    bad((t) => (shots(t)[1].id = 7), /shots are numbered 1 to 4 in order/);
    bad((t) => (shots(t)[1].motion = ""), /shot 2: a motion prompt is required/);
    bad((t) => (t.shots = []), /at least two shots/);
  });

  test("the treatment's own words are the prompt: the motion as written, then the keep line", () => {
    const script = planProduction(treatment(), { language: "en" }).script!.parsed!;
    expect(motionPrompt(script, script.shots[0])).toBe(
      "The falcon scans the valley. Slow orbit right, 35 mm. One single continuous shot. The characters keep their exact design. No children, no child-like figures, no dolls or toys.",
    );
  });

  test("the video models are the licensed ones of the bake-off (HunyuanVideo was refused for its licence)", () => {
    expect(VIDEO_MODELS).toEqual(["wan2.2-i2v-a14b", "wan2.2-i2v-a14b-hq", "ltx-video-0.9.8-13b-distilled"]);
  });
});

describe("tail-frame chaining and redoing one shot", () => {
  test("reshooting a shot also reshoots the shots chained to its last frame, and only those", () => {
    const p = planProduction(treatment(), { language: "en" });
    for (const s of p.shots) s.video = { runId: `v${s.id}`, studioKey: "video-generation", status: "SUCCEEDED", output: `clip-${s.id}` };
    markReshoot(p, [3]);
    expect(p.shots.filter((s) => s.review === "reshoot").map((s) => s.id)).toEqual([3, 4]);
    markReshoot(p, [1]);
    expect(p.shots.find((s) => s.id === 2)?.review).toBeUndefined(); // shot 2 starts from its own keyframe
  });
});

function fakePort(): StudioPort & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let n = 0;
  return {
    calls,
    async run(studioKey, inputs): Promise<FinishedRun> {
      calls.push([studioKey, inputs]);
      n += 1;
      return { id: `run-${n}`, status: "SUCCEEDED", outputs: [{ key: studioKey === "video-sound" ? "video" : "out", value: `/api/v1/assets/job-${n}/out` }] };
    },
    async reupload(output, lastFrame, at): Promise<string> {
      return `${lastFrame ? "last" : "key"}${at !== undefined ? `@${at}` : ""}:${output}`;
    },
  };
}

describe("the director follows the planned shots", () => {
  test("each shot's video run names that shot's model; a character with a reference render is uploaded, not drawn", async () => {
    const port = fakePort();
    const p = planProduction(treatment(), { language: "en" });
    const refs: string[] = [];
    await direct(p, port, {
      save: () => undefined,
      log: () => undefined,
      reference: async (id) => {
        refs.push(id);
        return { runId: `sheet-${id}`, studioKey: "reference-sheet", status: "SUCCEEDED", output: `asset-${id}` };
      },
    });
    expect(refs).toEqual(["falcon", "pigeon"]);
    const videos = port.calls.filter(([k]) => k === "video-generation").map(([, i]) => i.model);
    expect(videos).toEqual(["wan2.2-i2v-a14b-hq", "ltx-video-0.9.8-13b-distilled", "wan2.2-i2v-a14b-hq", "wan2.2-i2v-a14b-hq"]);
    expect(port.calls.filter(([k]) => k === "image-generation")).toHaveLength(3); // shot 4 is chained: no keyframe
  });
});

describe("pod jobs: the pending shots, for a GPU host that runs the worker's own generator", () => {
  test("each pending shot is one job: its model's size and frames, its seed, and where it starts", () => {
    const p: Production = planProduction(treatment(), { language: "en" });
    const jobs = podJobs(p);
    // A shot is made as long as it is used (plus a handle), never longer than one clip: 2.67 s → 53 frames at 16 fps.
    expect(jobs.map((j) => [j.shot, j.model, j.width, j.height, j.frames])).toEqual([
      [1, "wan2.2-i2v-a14b-hq", 1280, 720, 81],
      [2, "ltx-video-0.9.8-13b-distilled", 1216, 704, 89],
      [3, "wan2.2-i2v-a14b-hq", 1280, 720, 53],
      [4, "wan2.2-i2v-a14b-hq", 1280, 720, 53],
    ]);
    for (const j of jobs) expect((j.frames - 1) % (j.fps === 24 ? 8 : 4)).toBe(0);
    expect(jobs[0].start).toEqual({ keyframe: 1 });
    expect(jobs[3].start).toEqual({ lastFrameOf: 3 });
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(4);
    expect(jobs[0].name).toBe("01-falcon-cliff-t0");
    for (const s of p.shots) s.video = { runId: "x", studioKey: "video-generation", status: "SUCCEEDED" };
    markReshoot(p, [3]);
    expect(podJobs(p).map((j) => j.name)).toEqual(["03-pigeon-takeoff-t1", "04-pigeon-flight-t1"]);
  });
});

describe("reference and review sheets are ffmpeg graphs (no image library)", () => {
  test("a reference sheet puts each render side by side on neutral grey", () => {
    const args = sheetArgs(["a.png", "b.png"], "sheet.png");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args.join(" ")).toMatch(/hstack=inputs=2/);
    expect(args.join(" ")).toMatch(/color=0x808080/);
    expect(args[args.length - 1]).toBe("sheet.png");
    expect(sheetArgs(["a.png"], "s.png").join(" ")).not.toMatch(/hstack/);
  });

  test("a review sheet sets a frame every eight under the reference sheet, to compare the take with the render", () => {
    const args = reviewArgs("take.mp4", "sheet.png", "review.jpg");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toMatch(/not\(mod\(n\\,8\)\)/);
    expect(graph).toMatch(/tile=6x2/);
    expect(graph).toMatch(/vstack/);
  });
});

describe("a take made on a GPU host is recorded in the production", () => {
  test("recording a take marks the shot done; reshooting it gives the next attempt a new name and seed", () => {
    const p = planProduction(treatment(), { language: "en" });
    for (const id of [1, 2, 3, 4]) recordTake(p, id, `/takes/${id}.mp4`, 600);
    expect(podJobs(p)).toEqual([]);
    expect(p.history.map((h) => h.runId)).toEqual(["pod:01-t0", "pod:02-t0", "pod:03-t0", "pod:04-t0"]);
    const before = podJobs(markReshoot(planProduction(treatment(), { language: "en" }), [1]))[0].seed;
    markReshoot(p, [1]);
    const [job] = podJobs(p);
    expect(job.name).toBe("01-falcon-cliff-t1");
    expect(job.seed).not.toBe(podJobs(planProduction(treatment(), { language: "en" }))[0].seed);
    expect(job.seed).toBe(before);
    recordTake(p, 1, "/takes/1b.mp4");
    expect(p.shots[0].video?.runId).toBe("pod:01-t1");
    expect(() => recordTake(p, 9, "x")).toThrow(/not in this production/);
  });
});

describe("a treatment that changes during the production", () => {
  test("replanning keeps every shot already made and adds the new ones; a removed shot's take is dropped", () => {
    const p = planProduction(treatment(), { language: "en" });
    recordTake(p, 1, "/takes/1.mp4", 900);
    recordTake(p, 3, "/takes/3.mp4", 600);
    const changed = treatment();
    const shots = changed.shots as Array<Record<string, unknown>>;
    shots.push({ ...shots[1], id: 5, slug: "sunrise", continuous: false });
    const again = replan(p, changed, { language: "en" });
    expect(again.script?.parsed?.shots.map((s) => s.slug)).toEqual(["falcon-cliff", "valley", "pigeon-takeoff", "pigeon-flight", "sunrise"]);
    expect(podJobs(again).map((j) => j.shot)).toEqual([2, 4, 5]);
    expect(again.history).toHaveLength(2);
    expect(again.brief.seed).toBe(p.brief.seed);
    const shorter = treatment();
    (shorter.shots as unknown[]).splice(3, 1);
    expect(replan(again, shorter, { language: "en" }).shots.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("a chained shot can start from a chosen second of the previous take", () => {
  test("chainAt is kept, exported to the pod, and passed to the reupload; it is refused on a shot that is not chained", async () => {
    const t = treatment();
    (t.shots as Array<Record<string, unknown>>)[3].chainAt = 1.2;
    const p = planProduction(t, { language: "en" });
    expect(p.script?.parsed?.shots[3].chainAt).toBe(1.2);
    expect(podJobs(p)[3].start).toEqual({ lastFrameOf: 3, at: 1.2 });
    const port = fakePort();
    await direct(p, port, { save: () => undefined, log: () => undefined });
    expect(port.calls.filter(([k]) => k === "video-generation")[3][1].image).toMatch(/^last@1\.2:/);
    const bad = treatment();
    (bad.shots as Array<Record<string, unknown>>)[2].chainAt = 1;
    expect(() => planProduction(bad, { language: "en" })).toThrow(/chainAt is a second .* for a continuous shot only/);
  });

  test("a file name that starts with a dash is never an ffmpeg option", () => {
    expect(ffmpegOperand("-f")).toBe("./-f");
    expect(ffmpegOperand("take.mp4")).toBe("take.mp4");
    expect(sheetArgs(["-evil.png"], "-out.png")).toEqual(expect.arrayContaining(["./-evil.png", "./-out.png"]));
    expect(reviewArgs("-t.mp4", "s.png", "o.jpg")).toContain("./-t.mp4");
  });
});
