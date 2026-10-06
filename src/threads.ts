/**
 * @file threads.ts
 * @description Local thread management for persistent conversation history.
 * Mirrors orazaka-ui's useThreadManagement and useMessageHistory hooks.
 * Threads and messages are persisted to ~/.orazaka-threads/.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { ChatThread, StoredMessage, CliConfig } from './types/local.types';

const CONFIG_PATH = path.join(os.homedir(), '.orazaka-cli.json');
const THREADS_DIR = path.join(os.homedir(), '.orazaka-threads');

// ── Config Persistence ───────────────────────────────────────────────────────

/**
 * Loads the CLI configuration from disk.
 *
 * @returns The parsed config, or null if absent or malformed.
 */
export function loadConfig(): CliConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (raw && typeof raw.token === 'string' && typeof raw.username === 'string') {
      return {
        token: raw.token,
        username: raw.username,
        activeThreadId: raw.activeThreadId || crypto.randomUUID(),
        threads: Array.isArray(raw.threads) ? raw.threads : [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the CLI configuration to disk.
 *
 * @param config - The config object to write.
 */
export function saveConfig(config: CliConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Ensures the config file exists and returns a guaranteed config.
 * If no config exists, exits with an auth error.
 *
 * @returns The loaded config.
 */
export function requireAuth(): CliConfig {
  const config = loadConfig();
  if (!config?.token) {
    console.error('\x1b[31mError: Unauthorized. Please run "login" command first.\x1b[0m');
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  }
  return config;
}

// ── Thread Management ────────────────────────────────────────────────────────

/**
 * Creates a new conversation thread and persists it to the config.
 *
 * @param title - Optional display title for the thread.
 * @returns The newly created thread.
 */
export function createThread(title?: string): ChatThread {
  const config = requireAuth();
  const thread: ChatThread = {
    conversationId: crypto.randomUUID(),
    title: title || 'New Memory Block',
    updatedAt: Date.now(),
  };
  const updated: CliConfig = {
    ...config,
    activeThreadId: thread.conversationId,
    threads: [thread, ...config.threads],
  };
  saveConfig(updated);
  return thread;
}

/**
 * Lists all stored conversation threads.
 *
 * @returns The array of threads, most recent first.
 */
export function listThreads(): ChatThread[] {
  const config = loadConfig();
  return config?.threads || [];
}

/**
 * Switches the active thread to the given ID.
 *
 * @param threadId - The conversation ID to activate.
 */
export function switchThread(threadId: string): void {
  const config = requireAuth();
  const exists = config.threads.some((t) => t.conversationId === threadId);
  if (!exists) {
    console.error(`\x1b[31mError: Thread "${threadId}" not found.\x1b[0m`);
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  }
  saveConfig({ ...config, activeThreadId: threadId });
}

/**
 * Updates the title of a thread (e.g., after the first message).
 *
 * @param threadId - The conversation ID.
 * @param title - The new title.
 */
export function updateThreadTitle(threadId: string, title: string): void {
  const config = loadConfig();
  if (!config) return;
  const updated = config.threads.map((t) =>
    t.conversationId === threadId ? { ...t, title, updatedAt: Date.now() } : t,
  );
  saveConfig({ ...config, threads: updated });
}

// ── Message History ──────────────────────────────────────────────────────────

/**
 * Resolves the file path for a thread's message history.
 *
 * @param threadId - The conversation ID.
 * @returns The absolute path to the thread's JSON file.
 */
function threadFilePath(threadId: string): string {
  return path.join(THREADS_DIR, `${threadId}.json`);
}

/**
 * Loads messages for a given thread from disk.
 *
 * @param threadId - The conversation ID.
 * @returns The array of stored messages.
 */
export function loadMessages(threadId: string): StoredMessage[] {
  const fp = threadFilePath(threadId);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Appends a message to a thread's persistent history.
 *
 * @param threadId - The conversation ID.
 * @param message - The message to append.
 */
export function appendMessage(threadId: string, message: StoredMessage): void {
  fs.mkdirSync(THREADS_DIR, { recursive: true });
  const messages = loadMessages(threadId);
  messages.push(message);
  fs.writeFileSync(threadFilePath(threadId), JSON.stringify(messages, null, 2), 'utf-8');
}
