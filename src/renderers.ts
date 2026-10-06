/**
 * @file renderers.ts
 * @description Output rendering pipeline for multi-modal CLI responses.
 * Handles text, image (Data URL → file), audio (Data URL → file), and video (Base64 → file).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { format } from 'date-fns';
import type { TimelineMessage } from './types/api.types';
import { ROUTER_URL } from './utils/config';

const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;

/**
 * Extracts MIME type and raw binary bytes from an RFC 2397 Data URL.
 *
 * @param dataUrl - The full data URL string.
 * @returns Decoded buffer and MIME type, or null if the format is invalid.
 */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = DATA_URL_REGEX.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

/**
 * Determines a file extension from a MIME type string.
 *
 * @param mime - The MIME type (e.g., `image/png`, `audio/mp3`).
 * @returns A file extension including the dot.
 */
function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'audio/mp3': '.mp3',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
  };
  return map[mime] || '.bin';
}

/**
 * Writes raw binary data to disk and prints a confirmation.
 *
 * @param buffer - The binary payload.
 * @param savePath - Absolute or relative path to the target file.
 */
function writeToDisk(buffer: Buffer, savePath: string): void {
  const resolved = path.resolve(savePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, buffer);
  const sizeKb = (buffer.length / 1024).toFixed(1);
  console.log(`\x1b[32m✓ Saved to ${resolved} (${sizeKb} KB)\x1b[0m`);
}

/**
 * Generates a timestamped filename for auto-saved media.
 *
 * @param prefix - A descriptive prefix (e.g., `orazaka-image`).
 * @param ext - The file extension including the dot.
 * @returns A filename string.
 */
function autoFileName(prefix: string, ext: string): string {
  const ts = format(new Date(), "yyyy-MM-dd'T'HH-mm-ss");
  return `${prefix}-${ts}${ext}`;
}

// ── Public Renderers ─────────────────────────────────────────────────────────

/**
 * Renders plain text content to stdout.
 *
 * @param content - The text content.
 */
export function renderText(content: string): void {
  console.log(content);
}

/**
 * Renders an image response. If the content is a Data URL, it is decoded and saved to disk.
 *
 * @param content - The image content (Data URL or plain text description).
 * @param savePath - Optional explicit save path; auto-generates if omitted.
 */
async function downloadUrl(urlStr: string): Promise<Buffer> {
  const fullUrl = urlStr.startsWith('http') ? urlStr : `${ROUTER_URL}${urlStr}`;
  const response = await fetch(fullUrl);
  if (!response.ok) {
    throw new Error(`Failed to download media: status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Configuration for a media renderer kind.
 */
interface MediaRenderConfig {
  readonly prefix: string;
  readonly defaultExt: string;
  readonly color: string;
  readonly label: string;
  readonly formatSuccess: (target: string, buffer: Buffer, mime?: string) => string[];
}

/**
 * Shared media content renderer. Handles the decode/download/save pipeline
 * and delegates formatting to the per-kind config.
 */
async function renderMediaContent(
  content: string,
  config: MediaRenderConfig,
  savePath?: string,
): Promise<void> {
  const decoded = decodeDataUrl(content);
  if (decoded) {
    const ext = extensionFromMime(decoded.mime);
    const target = savePath || autoFileName(config.prefix, ext);
    writeToDisk(decoded.buffer, target);
    for (const line of config.formatSuccess(target, decoded.buffer, decoded.mime)) {
      console.log(line);
    }
  } else if (content.startsWith('http') || content.startsWith('/uploads')) {
    try {
      const buffer = await downloadUrl(content);
      const target = savePath || autoFileName(config.prefix, config.defaultExt);
      writeToDisk(buffer, target);
      for (const line of config.formatSuccess(target, buffer)) {
        console.log(line);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${config.color}[${config.label}]\x1b[0m Failed to download ${config.label.toLowerCase()} URL: ${msg}`);
    }
  } else {
    console.log(`${config.color}[${config.label}]\x1b[0m ${content}`);
  }
}

// ── Media Render Configs ─────────────────────────────────────────────────────

const IMAGE_CONFIG: MediaRenderConfig = {
  prefix: 'orazaka-image',
  defaultExt: '.png',
  color: '\x1b[35m',
  label: 'IMAGE',
  formatSuccess: (target, buffer, mime) => [
    `\x1b[35m┌─ IMAGE OUTPUT ─────────────────────────────────┐\x1b[0m`,
    `\x1b[35m│\x1b[0m Format: ${(mime || 'image/png').padEnd(40)} \x1b[35m│\x1b[0m`,
    `\x1b[35m│\x1b[0m Size:   ${(buffer.length / 1024).toFixed(1).padEnd(37)} KB \x1b[35m│\x1b[0m`,
    `\x1b[35m│\x1b[0m File:   ${path.basename(target).padEnd(40)} \x1b[35m│\x1b[0m`,
    `\x1b[35m└────────────────────────────────────────────────┘\x1b[0m`,
  ],
};

const AUDIO_CONFIG: MediaRenderConfig = {
  prefix: 'orazaka-speech',
  defaultExt: '.mp3',
  color: '\x1b[33m',
  label: 'AUDIO',
  formatSuccess: (target) => [
    `\x1b[33m🔊 Audio saved → ${path.resolve(target)}\x1b[0m`,
    `\x1b[90m   Hint: afplay "${path.resolve(target)}" (macOS)\x1b[0m`,
  ],
};

const VIDEO_CONFIG: MediaRenderConfig = {
  prefix: 'orazaka-video',
  defaultExt: '.mp4',
  color: '\x1b[36m',
  label: 'VIDEO',
  formatSuccess: (target, buffer) => {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    return [
      `\x1b[36m🎬 Video saved → ${path.resolve(target)} (${sizeMb} MB)\x1b[0m`,
      `\x1b[90m   Hint: open "${path.resolve(target)}" (macOS QuickTime)\x1b[0m`,
    ];
  },
};

// ── Public Renderers ─────────────────────────────────────────────────────────

/**
 * Renders an image response. If the content is a Data URL, it is decoded and saved to disk.
 * If it's a URL, the image is downloaded and saved.
 */
export async function renderImage(content: string, savePath?: string): Promise<void> {
  return renderMediaContent(content, IMAGE_CONFIG, savePath);
}

/**
 * Renders an audio response. If the content is a Data URL, it is decoded and saved to disk.
 * If it's a URL, the audio is downloaded and saved.
 */
export async function renderAudio(content: string, savePath?: string): Promise<void> {
  return renderMediaContent(content, AUDIO_CONFIG, savePath);
}

/**
 * Renders a video response by decoding the Base64 payload and saving to disk.
 * If it's a URL, the video is downloaded and saved.
 */
export async function renderVideo(content: string, savePath?: string): Promise<void> {
  return renderMediaContent(content, VIDEO_CONFIG, savePath);
}

/**
 * Dispatches a timeline message to the appropriate media renderer.
 *
 * @param message - The timeline message with its discriminated kind.
 * @param savePath - Optional explicit save path for media output.
 */
export async function renderTimeline(message: TimelineMessage, savePath?: string): Promise<void> {
  switch (message.kind) {
    case 'text':
      renderText(message.content);
      break;
    case 'image':
      await renderImage(message.content, savePath);
      break;
    case 'audio':
      await renderAudio(message.content, savePath);
      break;
    case 'video':
      await renderVideo(message.content, savePath);
      break;
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

