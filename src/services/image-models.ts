/**
 * @file image-models.ts
 * @description The local image models: how each one is downloaded, verified and served by
 * stable-diffusion.cpp's `sd-server` (Metal).
 *
 * The recipes live in `image-model-recipes.json`, not in code. A recipe's `id` is the `model_name` of its
 * `orazaka_models` row: the catalogue decides which model is the image default (data in the DB,
 * AGENTS.md §4), this module only knows how to install and launch it. `sd-server` serves one model
 * at a time, so `orazaka start` launches the catalogue's default and nothing else — serving another
 * model under the default's name would put the wrong model on every bill and every caption.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import catalogue from "./image-model-recipes.json";

/** What a file is to sd-server: each role is one launch flag. */
export type ImageModelFileRole = "model" | "diffusion-model" | "llm" | "vae" | "clip_l" | "t5xxl";

export interface ImageModelFile {
  readonly role: ImageModelFileRole;
  /** Relative to the models directory (`~/models/stable-diffusion`). */
  readonly path: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ImageModelRecipe {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly summary: string;
  readonly ramGb: number;
  readonly measured: string;
  readonly files: readonly ImageModelFile[];
  readonly launch: {
    readonly steps: number;
    readonly cfgScale: number;
    readonly width: number;
    readonly height: number;
    readonly flags: readonly string[];
  };
}

const FLAG: Record<ImageModelFileRole, string> = {
  model: "-m",
  "diffusion-model": "--diffusion-model",
  llm: "--llm",
  vae: "--vae",
  clip_l: "--clip_l",
  t5xxl: "--t5xxl",
};

/** Every recipe, in order of preference. */
export const IMAGE_MODELS: readonly ImageModelRecipe[] = (catalogue.models as ImageModelRecipe[]).map(
  (recipe) => Object.freeze(recipe),
);

/** @returns the recipe for a catalogue model name, or `undefined` when none is installable. */
export function findImageModel(id: string): ImageModelRecipe | undefined {
  return IMAGE_MODELS.find((recipe) => recipe.id === id.trim());
}

/** Total download size of a recipe, in bytes. */
export function downloadBytes(recipe: ImageModelRecipe): number {
  return recipe.files.reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * A file counts as installed when it is there at its declared size. The size is checked on every
 * start (cheap); the checksum only after a download (a 4 GB hash is not a start-up cost).
 */
export function missingFiles(recipe: ImageModelRecipe, modelsDir: string): ImageModelFile[] {
  return recipe.files.filter((file) => {
    const target = path.join(modelsDir, file.path);
    return !fs.existsSync(target) || fs.statSync(target).size !== file.bytes;
  });
}

export function isInstalled(recipe: ImageModelRecipe, modelsDir: string): boolean {
  return missingFiles(recipe, modelsDir).length === 0;
}

/**
 * The sd-server command line for a recipe: its files, then its own sampling recipe as the server's
 * defaults. Requests still send their step count, size, seed and negative prompt (the engine's
 * image adapter); guidance and the model's flags are the recipe's alone.
 */
export function sdServerArgs(
  recipe: ImageModelRecipe,
  modelsDir: string,
  options: { port: number; seed?: string },
): string[] {
  const files = recipe.files.flatMap((file) => [FLAG[file.role], path.join(modelsDir, file.path)]);
  return [
    "--listen-port", String(options.port),
    ...files,
    "--steps", String(recipe.launch.steps),
    "--cfg-scale", String(recipe.launch.cfgScale),
    "-W", String(recipe.launch.width),
    "-H", String(recipe.launch.height),
    "--seed", options.seed ?? "-1",
    ...recipe.launch.flags,
  ];
}

/** Progress of one file's download, for the caller to render. */
export interface DownloadProgress {
  readonly file: ImageModelFile;
  readonly received: number;
}

/**
 * Downloads every missing file of a recipe into the models directory and verifies its SHA-256.
 *
 * A file is written to `<path>.part` and renamed only once its checksum matches, so an interrupted
 * or tampered download never looks installed. Files already present at their size are skipped.
 */
export async function pullImageModel(
  recipe: ImageModelRecipe,
  modelsDir: string,
  deps: {
    fetch: (url: string) => Promise<Response>;
    onProgress?: (progress: DownloadProgress) => void;
  },
): Promise<ImageModelFile[]> {
  const pulled: ImageModelFile[] = [];
  for (const file of missingFiles(recipe, modelsDir)) {
    const target = path.join(modelsDir, file.path);
    const partial = `${target}.part`;
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const response = await deps.fetch(file.url);
    if (!response.ok || !response.body) {
      throw new Error(`Download of ${file.path} failed: HTTP ${String(response.status)}`);
    }
    const hash = crypto.createHash("sha256");
    let received = 0;
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      deps.onProgress?.({ file, received });
    });
    await pipeline(body, fs.createWriteStream(partial));

    const digest = hash.digest("hex");
    if (digest !== file.sha256 || received !== file.bytes) {
      fs.rmSync(partial, { force: true });
      throw new Error(
        `${file.path} does not match its recipe (sha256 ${digest}, ${String(received)} bytes): removed`,
      );
    }
    fs.renameSync(partial, target);
    pulled.push(file);
  }
  return pulled;
}
