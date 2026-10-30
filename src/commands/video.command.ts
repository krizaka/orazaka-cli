import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import { requireAuth } from "../threads";
import { CAPABILITY, firstOutput, runComposerStudio } from "../services/composer.run";
import { renderVideo } from "../renderers";
import { Logger } from "../ui/logger";

/** The inputs a `video` flag set sends to the Studio: only what was chosen (the Studio's own defaults fill the rest). */
export function videoRunOptions(options: {
  duration?: string;
  model?: string;
  aspect?: string;
  seed?: string;
}): Record<string, unknown> {
  const aspect = options.aspect?.trim();
  if (aspect && !["9:16", "16:9", "1:1"].includes(aspect)) {
    throw new Error(`--aspect is one of 9:16, 16:9, 1:1 (got "${aspect}")`);
  }
  const seed = options.seed?.trim();
  if (seed && !/^\d{1,19}$/.test(seed)) {
    throw new Error(`--seed is a whole number (got "${seed}")`);
  }
  return {
    durationSeconds: Number.parseInt(options.duration ?? "", 10) || 4,
    model: options.model,
    aspect,
    seed,
  };
}

export const videoCommand = new Command("video")
  .description("Generate video from a text prompt")
  .argument("<prompt>", "Text prompt describing the desired video")
  .option("-d, --duration <seconds>", "Duration of the video in seconds", "4")
  .option("-m, --model <model>", "Specify AI model name")
  .option("-a, --aspect <ratio>", "Frame: 9:16 (default of the Studio), 16:9 or 1:1 — the model must make it")
  .option("-s, --seed <number>", "The same prompt, model and seed make the same shot again")
  .option("-o, --output <path>", "Specific file path to save the video")
  .action(
    async (
      prompt: string,
      options: { duration: string; output?: string; model?: string; aspect?: string; seed?: string },
    ) => {
      requireAuth();

      let runOptions: Record<string, unknown>;
      try {
        runOptions = videoRunOptions(options);
      } catch (err: unknown) {
        Logger.error(err instanceof Error ? err.message : "Invalid options");
        process.exit(1);
      }
      const durationSeconds = runOptions.durationSeconds as number;

      Logger.info(`Generating video (${durationSeconds}s)...`);
      Logger.hint(`Prompt: "${prompt}"`);
      if (options.model) {
        Logger.hint(`Model: "${options.model}"`);
      }
      Logger.hint("This may take a while depending on your hardware.\n");

      const s = await createSpinner();
      s.start("Starting the video-generation run...");

      try {
        // A run, not a POST to /api/v1/media/generation/video: the same work, through the
        // one door that meters it, keeps it for its class and records who asked (ADR-068).
        const run = await runComposerStudio({
          capabilityKey: CAPABILITY.video,
          primary: prompt,
          options: runOptions,
          onStatus: (status) => s.message(`Generating video... Status: ${status}`),
        });

        s.stop(`Generation complete — run ${run.id}`);
        await renderVideo(firstOutput(run), options.output);
      } catch (err: unknown) {
        s.stop("Video generation failed");
        const msg = err instanceof Error ? err.message : "Unknown error";
        Logger.error(`Video Generation Failed: ${msg}`);
        process.exit(1);
      }
    },
  );
