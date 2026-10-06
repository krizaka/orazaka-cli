import { Command } from "commander";
import { createSpinner } from "../ui/prompts";
import { requireAuth } from "../threads";
import { CAPABILITY, firstOutput, runComposerStudio } from "../services/composer.run";
import { renderVideo } from "../renderers";
import { Logger } from "../ui/logger";

export const videoCommand = new Command("video")
  .description("Generate video from a text prompt")
  .argument("<prompt>", "Text prompt describing the desired video")
  .option("-d, --duration <seconds>", "Duration of the video in seconds", "4")
  .option("-m, --model <model>", "Specify AI model name")
  .option("-o, --output <path>", "Specific file path to save the video")
  .action(async (prompt: string, options: { duration: string; output?: string; model?: string }) => {
    requireAuth();

    const durationSeconds = Number.parseInt(options.duration, 10) || 4;

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
        options: { durationSeconds, model: options.model },
        onStatus: (status) => s.message(`Generating video... Status: ${status}`),
      });

      s.stop("Generation complete");
      await renderVideo(firstOutput(run), options.output);
    } catch (err: unknown) {
      s.stop("Video generation failed");
      const msg = err instanceof Error ? err.message : "Unknown error";
      Logger.error(`Video Generation Failed: ${msg}`);
      process.exit(1);
    }
  });
