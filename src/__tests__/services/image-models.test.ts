/**
 * @file image-models.test.ts
 * @description The image model recipes: well-formed, commercially licensed, launched with their
 * own sampling recipe, and never installed from a download that does not match its checksum.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  IMAGE_MODELS,
  downloadBytes,
  findImageModel,
  isInstalled,
  missingFiles,
  pullImageModel,
  sdServerArgs,
  type ImageModelRecipe,
} from "../../services/image-models";

/** Licences that allow Orazaka's commercial use. A recipe outside this list is refused. */
const COMMERCIAL_LICENCES = ["Apache-2.0", "MIT", "CreativeML OpenRAIL-M", "CreativeML OpenRAIL++-M"];

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orz-image-models-"));
}

function recipeFor(content: Buffer): ImageModelRecipe {
  return {
    id: "tiny",
    label: "Tiny",
    family: "test",
    licence: "Apache-2.0",
    licenceUrl: "https://example.org",
    summary: "",
    ramGb: 1,
    measured: "",
    files: [
      {
        role: "diffusion-model",
        path: "tiny/model.gguf",
        url: "https://example.org/model.gguf",
        bytes: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      },
    ],
    launch: { steps: 4, cfgScale: 1, width: 1024, height: 1024, flags: ["--diffusion-fa"] },
  };
}

function serving(content: Buffer): (url: string) => Promise<Response> {
  return () => Promise.resolve(new Response(new Uint8Array(content)));
}

describe("image model recipes", () => {
  test("ids are unique and every file is pinned by size and sha256", () => {
    const ids = IMAGE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const recipe of IMAGE_MODELS) {
      expect(recipe.files.length).toBeGreaterThan(0);
      for (const file of recipe.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.url).toMatch(/^https:\/\/huggingface\.co\//);
        expect(path.isAbsolute(file.path)).toBe(false);
        expect(file.path).not.toContain("..");
      }
    }
  });

  test("only commercially usable licences are listed", () => {
    for (const recipe of IMAGE_MODELS) {
      expect(COMMERCIAL_LICENCES).toContain(recipe.licence);
    }
  });

  test("the preferred recipe is FLUX.2 [klein] 4B, at its distilled 4 steps and guidance 1", () => {
    const first = IMAGE_MODELS[0];
    expect(first.id).toBe("flux-2-klein-4b");
    expect(first.launch.steps).toBe(4);
    expect(first.launch.cfgScale).toBe(1);
    expect(downloadBytes(first)).toBeGreaterThan(8e9);
  });

  test("findImageModel trims and returns undefined for an unknown id", () => {
    expect(findImageModel(" z-image-turbo ")?.id).toBe("z-image-turbo");
    expect(findImageModel("sdxl-turbo-gguf")).toBeUndefined();
  });
});

describe("sdServerArgs", () => {
  test("maps each file to its flag and states the recipe's sampling", () => {
    const klein = findImageModel("flux-2-klein-4b") as ImageModelRecipe;
    const args = sdServerArgs(klein, "/m", { port: 8086 });

    expect(args.slice(0, 2)).toEqual(["--listen-port", "8086"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--diffusion-model",
        "/m/flux2-klein-4b/flux-2-klein-4b-Q8_0.gguf",
        "--llm",
        "/m/flux2-klein-4b/Qwen3-4B-Q8_0.gguf",
        "--vae",
        "/m/flux2-klein-4b/flux2-vae.safetensors",
        "--diffusion-fa",
      ]),
    );
    expect(args[args.indexOf("--steps") + 1]).toBe("4");
    expect(args[args.indexOf("--cfg-scale") + 1]).toBe("1");
    expect(args[args.indexOf("--seed") + 1]).toBe("-1");
  });

  test("a single-file checkpoint is passed with -m", () => {
    const sd15 = findImageModel("v1-5-pruned-emaonly") as ImageModelRecipe;
    const args = sdServerArgs(sd15, "/m", { port: 1, seed: "42" });
    expect(args[args.indexOf("-m") + 1]).toBe("/m/v1-5-pruned-emaonly.safetensors");
    expect(args[args.indexOf("--seed") + 1]).toBe("42");
  });
});

describe("pullImageModel", () => {
  test("downloads, verifies and installs a missing file", async () => {
    const dir = tempDir();
    const content = Buffer.from("weights");
    const recipe = recipeFor(content);
    expect(isInstalled(recipe, dir)).toBe(false);

    const pulled = await pullImageModel(recipe, dir, { fetch: serving(content) });

    expect(pulled).toHaveLength(1);
    expect(isInstalled(recipe, dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, "tiny/model.gguf.part"))).toBe(false);
  });

  test("a file already installed at its size is not downloaded again", async () => {
    const dir = tempDir();
    const content = Buffer.from("weights");
    const recipe = recipeFor(content);
    fs.mkdirSync(path.join(dir, "tiny"));
    fs.writeFileSync(path.join(dir, "tiny/model.gguf"), content);
    const fetchSpy = jest.fn(serving(content));

    expect(await pullImageModel(recipe, dir, { fetch: fetchSpy })).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a download that does not match its checksum is removed, never installed", async () => {
    const dir = tempDir();
    const recipe = recipeFor(Buffer.from("weights"));

    await expect(pullImageModel(recipe, dir, { fetch: serving(Buffer.from("tamper!")) })).rejects.toThrow(
      /does not match its recipe/,
    );
    expect(missingFiles(recipe, dir)).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "tiny/model.gguf.part"))).toBe(false);
  });

  test("an HTTP error fails the pull", async () => {
    const dir = tempDir();
    const recipe = recipeFor(Buffer.from("weights"));
    await expect(
      pullImageModel(recipe, dir, { fetch: () => Promise.resolve(new Response(null, { status: 404 })) }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
