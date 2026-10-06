import * as fs from "node:fs";
import { createSpinner } from "../ui/prompts";
import { ChatApi } from "../services/chat.api";
import { CAPABILITY, firstOutput, runComposerStudio } from "../services/composer.run";
import { ApiClient } from "../services/api-client";
import { renderTimeline } from "../renderers";
import { Logger } from "../ui/logger";
import { appendMessage } from "../threads";
import type { ParsedArgs } from "./chat.types";

/** The synchronous chat endpoint the conversation service serves (AGENTS.md §6). */
const CHAT_STREAM_PATH = "/api/v1/chat/stream";

/**
 * Handles image generation, as a run of the Studio that ships that capability (ADR-068).
 */
export async function handleImageGeneration(
  parsed: ParsedArgs,
  conversationId: string,
): Promise<void> {
  const prompt = parsed.flagValue || parsed.prompt;
  const s = await createSpinner();
  s.start("Generating image...");
  const run = await runComposerStudio({
    capabilityKey: CAPABILITY.image,
    primary: prompt,
    options: { model: parsed.model },
    onStatus: (status) => s.message(`Processing image... Status: ${status}`),
  });
  s.stop("Image ready");
  const content = firstOutput(run);
  await renderTimeline({ kind: "image", content }, parsed.savePath);
  appendMessage(conversationId, { role: "assistant", content, kind: "image", timestamp: Date.now() });
}

/**
 * Handles speech synthesis, as a run of the Studio that ships that capability (ADR-068).
 */
export async function handleSpeechGeneration(
  parsed: ParsedArgs,
  conversationId: string,
): Promise<void> {
  const prompt = parsed.flagValue || parsed.prompt;
  const s = await createSpinner();
  s.start("Synthesizing speech...");
  const run = await runComposerStudio({
    capabilityKey: CAPABILITY.speech,
    primary: prompt,
    options: { model: parsed.model, voice: parsed.voice },
    onStatus: (status) => s.message(`Processing speech... Status: ${status}`),
  });
  s.stop("Speech ready");
  const content = firstOutput(run);
  await renderTimeline({ kind: "audio", content }, parsed.savePath);
  appendMessage(conversationId, { role: "assistant", content, kind: "audio", timestamp: Date.now() });
}

/**
 * Handles vision (image) analysis via upload + polling.
 */
export async function handleVisionAnalysis(
  parsed: ParsedArgs,
  conversationId: string,
): Promise<void> {
  if (!parsed.flagValue || !fs.existsSync(parsed.flagValue)) {
    throw new Error(`File not found: ${parsed.flagValue}`);
  }

  const s = await createSpinner();
  s.start("Uploading image...");
  const uploadRes = await ApiClient.uploadFile(parsed.flagValue);
  s.message("Starting the image-analysis run...");
  const run = await runComposerStudio({
    capabilityKey: CAPABILITY.vision,
    primary: uploadRes.assetId,
    prompt: parsed.prompt,
    options: { model: parsed.model },
    onStatus: (status) => s.message(`Processing image... Status: ${status}`),
  });
  const analysisResult = firstOutput(run);
  s.stop("Analysis complete");
  console.log(analysisResult);
  appendMessage(conversationId, { role: "assistant", content: analysisResult, kind: "image", timestamp: Date.now() });
}

/**
 * Handles audio analysis via upload + polling.
 */
export async function handleAudioAnalysis(
  parsed: ParsedArgs,
  conversationId: string,
): Promise<void> {
  if (!parsed.flagValue || !fs.existsSync(parsed.flagValue)) {
    throw new Error(`File not found: ${parsed.flagValue}`);
  }

  const s = await createSpinner();
  s.start("Uploading audio...");
  const uploadRes = await ApiClient.uploadFile(parsed.flagValue);
  s.message("Starting the audio-analysis run...");
  const run = await runComposerStudio({
    capabilityKey: CAPABILITY.audio,
    primary: uploadRes.assetId,
    options: { model: parsed.model },
    onStatus: (status) => s.message(`Processing audio... Status: ${status}`),
  });
  const analysisResult = firstOutput(run);
  s.stop("Analysis complete");
  console.log(analysisResult);
  appendMessage(conversationId, { role: "assistant", content: analysisResult, kind: "audio", timestamp: Date.now() });
}

/**
 * Handles text streaming via SSE REST.
 */
export async function handleTextStream(
  parsed: ParsedArgs,
  conversationId: string,
  token: string,
): Promise<void> {
  let accumulated = "";
  // The path is the CLI's own constant now, like every other path it calls. It used to come from
  // the operation graph, which read it off the capability row's uri_path — a column whose values
  // named door 1's deleted endpoints for every capability but this one (ADR-069 §5).
  await ChatApi.streamRest(
    CHAT_STREAM_PATH,
    conversationId,
    parsed.prompt,
    token,
    (content) => {
      process.stdout.write(content);
      accumulated += content;
    },
    (err) => {
      Logger.error(`Stream error: ${err.message}`);
    },
    () => {
      if (accumulated) {
        appendMessage(conversationId, { role: "assistant", content: accumulated, kind: "text", timestamp: Date.now() });
      }
    },
  );
}
