/**
 * @file renderers.test.ts
 * @description Tests for the CLI output rendering pipeline — text, image, audio, video.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  renderText,
  renderImage,
  renderAudio,
  renderVideo,
  renderTimeline,
} from "../renderers";
import type { TimelineMessage } from "../types/api.types";

// ── Mock env module ──────────────────────────────────────────────────────────
jest.mock("../utils/config", () => ({
  ROUTER_URL: "http://localhost:8080",
}));

// ── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// ── Console capture ──────────────────────────────────────────────────────────
let logOutput: string[] = [];
const originalLog = console.log;

beforeEach(() => {
  logOutput = [];
  mockFetch.mockReset();
  console.log = (...args: unknown[]) => {
    logOutput.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
});

// ── renderText ───────────────────────────────────────────────────────────────

describe("renderText", () => {
  test("prints content to stdout", () => {
    renderText("Hello, world!");
    expect(logOutput).toContain("Hello, world!");
  });

  test("handles empty string", () => {
    renderText("");
    expect(logOutput).toContain("");
  });
});

// ── renderImage ──────────────────────────────────────────────────────────────

describe("renderImage", () => {
  test("plain text fallback when not a Data URL", async () => {
    await renderImage("A description of an image");
    expect(logOutput.some((l) => l.includes("[IMAGE]"))).toBe(true);
    expect(logOutput.some((l) => l.includes("A description of an image"))).toBe(true);
  });

  test("decodes and saves valid PNG Data URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-test-"));
    const savePath = path.join(tmpDir, "test.png");

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await renderImage(`data:image/png;base64,${pngBase64}`, savePath);

    expect(fs.existsSync(savePath)).toBe(true);
    expect(logOutput.some((l) => l.includes("IMAGE OUTPUT"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("auto-generates filename when savePath omitted", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await renderImage(`data:image/png;base64,${pngBase64}`);

    expect(logOutput.some((l) => l.includes("IMAGE OUTPUT"))).toBe(true);
    // Cleanup auto-generated file
    const savedLine = logOutput.find((l) => l.includes("Saved to"));
    if (savedLine) {
      const match = savedLine.match(/Saved to (.+?) \(/);
      if (match) fs.rmSync(match[1], { force: true });
    }
  });

  test("downloads image from URL and saves", async () => {
    const fakeBuffer = Buffer.from("fake-image-data");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBuffer.buffer.slice(
        fakeBuffer.byteOffset,
        fakeBuffer.byteOffset + fakeBuffer.byteLength,
      ),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-dl-"));
    const savePath = path.join(tmpDir, "download.png");
    await renderImage("http://example.com/image.png", savePath);

    expect(mockFetch).toHaveBeenCalledWith("http://example.com/image.png");
    expect(logOutput.some((l) => l.includes("IMAGE OUTPUT"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("downloads image from relative /uploads path", async () => {
    const fakeBuffer = Buffer.from("relative-image");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBuffer.buffer.slice(
        fakeBuffer.byteOffset,
        fakeBuffer.byteOffset + fakeBuffer.byteLength,
      ),
    });

    await renderImage("/uploads/test.png");

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8080/uploads/test.png");
    // Cleanup
    const savedLine = logOutput.find((l) => l.includes("Saved to"));
    if (savedLine) {
      const match = savedLine.match(/Saved to (.+?) \(/);
      if (match) fs.rmSync(match[1], { force: true });
    }
  });

  test("handles download failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await renderImage("http://example.com/missing.png");

    expect(logOutput.some((l) => l.includes("Failed to download"))).toBe(true);
  });

  test("handles download rejection with non-Error object gracefully", async () => {
    mockFetch.mockRejectedValueOnce("Network failure string");

    await renderImage("http://example.com/error.png");

    expect(logOutput.some((l) => l.includes("Failed to download image URL: Network failure string"))).toBe(true);
  });

  test("uses .bin extension fallback for unknown MIME types when savePath is omitted", async () => {
    const fakeBase64 = Buffer.from("data").toString("base64");
    await renderImage(`data:application/octet-stream;base64,${fakeBase64}`);

    expect(logOutput.some((l) => l.includes("Format: application/octet-stream"))).toBe(true);
    // Cleanup auto-generated file ending with .bin
    const savedLine = logOutput.find((l) => l.includes("Saved to"));
    if (savedLine) {
      const match = savedLine.match(/Saved to (.+?\.bin) \(/);
      if (match) fs.rmSync(match[1], { force: true });
    }
  });
});

// ── renderAudio ──────────────────────────────────────────────────────────────

describe("renderAudio", () => {
  test("plain text fallback when not a Data URL", async () => {
    await renderAudio("some audio text");
    expect(logOutput.some((l) => l.includes("[AUDIO]"))).toBe(true);
  });

  test("decodes and saves valid audio Data URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
    const savePath = path.join(tmpDir, "test.mp3");

    const fakeBase64 = Buffer.from("fake-audio").toString("base64");
    await renderAudio(`data:audio/mp3;base64,${fakeBase64}`, savePath);

    expect(fs.existsSync(savePath)).toBe(true);
    expect(logOutput.some((l) => l.includes("Audio saved"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("downloads audio from URL and saves", async () => {
    const fakeBuffer = Buffer.from("fake-audio-data");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBuffer.buffer.slice(
        fakeBuffer.byteOffset,
        fakeBuffer.byteOffset + fakeBuffer.byteLength,
      ),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-dl-"));
    const savePath = path.join(tmpDir, "download.mp3");
    await renderAudio("http://example.com/audio.mp3", savePath);

    expect(logOutput.some((l) => l.includes("Audio saved"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("handles audio download failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await renderAudio("http://example.com/missing.mp3");

    expect(logOutput.some((l) => l.includes("Failed to download"))).toBe(true);
  });
});

// ── renderVideo ──────────────────────────────────────────────────────────────

describe("renderVideo", () => {
  test("plain text fallback when not a Data URL", async () => {
    await renderVideo("some video text");
    expect(logOutput.some((l) => l.includes("[VIDEO]"))).toBe(true);
  });

  test("decodes and saves valid video Data URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));
    const savePath = path.join(tmpDir, "test.mp4");

    const fakeBase64 = Buffer.from("fake-video-content").toString("base64");
    await renderVideo(`data:video/mp4;base64,${fakeBase64}`, savePath);

    expect(fs.existsSync(savePath)).toBe(true);
    expect(logOutput.some((l) => l.includes("Video saved"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("downloads video from URL and saves", async () => {
    const fakeBuffer = Buffer.from("fake-video-data");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBuffer.buffer.slice(
        fakeBuffer.byteOffset,
        fakeBuffer.byteOffset + fakeBuffer.byteLength,
      ),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-dl-"));
    const savePath = path.join(tmpDir, "download.mp4");
    await renderVideo("http://example.com/video.mp4", savePath);

    expect(logOutput.some((l) => l.includes("Video saved"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("handles video download failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await renderVideo("http://example.com/missing.mp4");

    expect(logOutput.some((l) => l.includes("Failed to download"))).toBe(true);
  });
});

// ── renderTimeline ───────────────────────────────────────────────────────────

describe("renderTimeline", () => {
  test("dispatches text message to renderText", async () => {
    const msg: TimelineMessage = { kind: "text", content: "Hello" };
    await renderTimeline(msg);
    expect(logOutput).toContain("Hello");
  });

  test("dispatches image message to renderImage", async () => {
    const msg: TimelineMessage = { kind: "image", content: "An image" };
    await renderTimeline(msg);
    expect(logOutput.some((l) => l.includes("[IMAGE]"))).toBe(true);
  });

  test("dispatches audio message to renderAudio", async () => {
    const msg: TimelineMessage = { kind: "audio", content: "audio link" };
    await renderTimeline(msg);
    expect(logOutput.some((l) => l.includes("[AUDIO]"))).toBe(true);
  });

  test("dispatches video message to renderVideo", async () => {
    const msg: TimelineMessage = { kind: "video", content: "video link" };
    await renderTimeline(msg);
    expect(logOutput.some((l) => l.includes("[VIDEO]"))).toBe(true);
  });

  test("throws/returns exhaustive check for invalid message kind", async () => {
    const msg = { kind: "invalid-kind", content: "Invalid content" };
    const result = await renderTimeline(msg as any);
    expect(result).toEqual(msg);
  });
});
