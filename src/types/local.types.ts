/**
 * @file local.types.ts
 * @description Local persistent state and thread configurations for the CLI.
 */

import type { TimelineMessage } from "./api.types";

export interface ChatThread {
  readonly conversationId: string;
  readonly title: string;
  readonly updatedAt: number;
}

export interface StoredMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly kind: TimelineMessage['kind'];
  readonly timestamp: number;
}

export interface CliConfig {
  readonly token: string;
  readonly username: string;
  readonly userId?: string;
  readonly activeThreadId: string;
  readonly threads: ChatThread[];
}
