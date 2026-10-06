/**
 * @file chat.api.ts
 * @description Outbound adapter for chat over REST SSE streaming (ADR-028: chat is REST SSE, not
 * GraphQL). Image/speech generation are runs, started through `composer.run.ts`; this module
 * owns only the token-by-token SSE transport.
 */

import { ROUTER_URL } from '../utils/config';

/** Parses SSE data payload and extracts the content value. */
function parseSseLine(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { content?: string };
    return parsed.content || null;
  } catch {
    return trimmed || null;
  }
}

/** Processes a single packet from SSE stream, returns true if DONE. */
function processPacket(
  packet: string,
  onNext: (content: string) => void,
  onComplete: () => void,
): boolean {
  const lines = packet.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const rawContent = line.slice(6).trim();

      if (rawContent === "[DONE]") {
        onComplete();
        return true;
      }

      const content = parseSseLine(rawContent);
      if (content) onNext(content);
    }
  }
  return false;
}

/** Consumes an SSE ReadableStream using async iteration and dispatches parsed content. */
async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onNext: (content: string) => void,
  onComplete: () => void,
  onError?: (error: Error) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });

      const packets = buffer.split("\n\n");
      buffer = packets.pop() || "";

      for (const packet of packets) {
        const completed = processPacket(packet, onNext, onComplete);
        if (completed) return;
      }
    }

    // Flush remaining buffer
    if (buffer.trim().startsWith("data: ")) {
      const content = parseSseLine(buffer.slice(6).trim());
      if (content) onNext(content);
    }

    onComplete();
  } catch (error) {
    const wrappedError = error instanceof Error ? error : new Error(String(error));
    if (onError) {
      onError(wrappedError);
    }
  }
}

export const ChatApi = {
  /**
   * Streams chat via REST SSE from the router.
   */
  streamRest: async (
    uriPath: string,
    conversationId: string,
    prompt: string,
    token: string,
    onNext: (content: string) => void,
    onError: (error: Error) => void,
    onComplete: () => void,
  ): Promise<void> => {
    const url = `${ROUTER_URL}${uriPath}/${conversationId}?prompt=${encodeURIComponent(prompt)}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`HTTP stream failed: status ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body available for streaming");
      }

      await consumeSseStream(response.body, onNext, onComplete, onError);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  },

  /**
   * Streams feature-to-code output via REST SSE POST from the router.
   */
  streamCodeRest: async (
    prompt: string,
    model: string | undefined,
    token: string,
    onNext: (content: string) => void,
    onError: (error: Error) => void,
    onComplete: () => void,
  ): Promise<void> => {
    const url = `${ROUTER_URL}/api/v1/code`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, model }),
      });

      if (!response.ok) {
        throw new Error(`HTTP stream failed: status ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body available for streaming");
      }

      await consumeSseStream(response.body, onNext, onComplete, onError);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  },
} as const;
