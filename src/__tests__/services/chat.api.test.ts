/**
 * @file chat.api.test.ts
 * @description Tests for ChatApi — REST SSE streaming and SSE consumption (ADR-028: chat is REST SSE;
 * image/speech are async REST jobs in MediaApi, not GraphQL).
 */

import { ChatApi } from "../../services/chat.api";

jest.mock("../../utils/config", () => ({ ROUTER_URL: "http://test-gateway:8080" }));

beforeEach(() => jest.clearAllMocks());

// ── streamRest ───────────────────────────────────────────────────────────────

describe("ChatApi.streamRest", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  test("parses SSE tokens and calls onNext", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      'data: {"content":"Hello"}\n\n',
      'data: {"content":" World"}\n\n',
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });

    const onComplete = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok-123",
      (c) => tokens.push(c),
      jest.fn(),
      onComplete,
    );

    expect(tokens).toEqual(["Hello", " World"]);
    expect(onComplete).toHaveBeenCalled();
  });

  test("calls onError on HTTP failure", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok-123",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain("500");
  });

  test("calls onError when body is null", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });

    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok-123",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain("No response body");
  });

  test("handles split SSE chunks correctly", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      'data: {"conte',
      'nt":"split"}\n\ndata: [DONE]\n\n',
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok-123",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["split"]);
  });

  test("handles plain text SSE data", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      "data: plain text\n\n",
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok-123",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["plain text"]);
  });
});

// ── streamCodeRest ───────────────────────────────────────────────────────────

describe("ChatApi.streamCodeRest", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  test("streams code generation via POST", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      'data: {"content":"function"}\n\n',
      'data: {"content":" hello()"}\n\n',
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamCodeRest(
      "write a function",
      "gpt-4o",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["function", " hello()"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://test-gateway:8080/api/v1/code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "write a function", model: "gpt-4o" }),
      }),
    );
  });

  test("calls onError on HTTP failure", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    const onError = jest.fn();

    await ChatApi.streamCodeRest("prompt", undefined, "tok", jest.fn(), onError, jest.fn());

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test("calls onError when body is null", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body: null });

    const onError = jest.fn();

    await ChatApi.streamCodeRest("prompt", undefined, "tok", jest.fn(), onError, jest.fn());

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── SSE edge cases ───────────────────────────────────────────────────────────

describe("SSE edge cases", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  test("flushes remaining buffer when stream ends without [DONE]", async () => {
    const tokens: string[] = [];
    // Stream ends with data in buffer (no trailing \n\n, no [DONE])
    const body = makeStream([
      'data: {"content":"first"}\n\n',
      'data: {"content":"last"}',
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });
    const onComplete = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      onComplete,
    );

    expect(tokens).toContain("first");
    expect(tokens).toContain("last");
    expect(onComplete).toHaveBeenCalled();
  });

  test("stream error triggers onError callback", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("stream broke"));
      },
    });

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });
    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test("fetch network error triggers onError", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("network down");
  });

  test("handles non-Error thrown object in stream", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue("string error");
    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("string error");
  });

  test("handles empty SSE data lines gracefully", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      "data: \n\n",
      'data: {"content":"real"}\n\n',
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["real"]);
  });

  test("ignores non-data SSE lines", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      "event: message\n",
      'data: {"content":"hello"}\n\n',
      "id: 42\n",
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["hello"]);
  });

  test("ignores valid JSON payload without content field", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      'data: {"foo":"bar"}\n\n',
      'data: {"content":"real"}\n\n',
      "data: [DONE]\n\n",
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["real"]);
  });

  test("handles non-Error thrown object inside stream chunk iteration", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"content":"ok"}\n\n'));
      },
      pull() {
        throw "stream chunk error string";
      }
    });

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });
    const onError = jest.fn();

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      jest.fn(),
      onError,
      jest.fn(),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("stream chunk error string");
  });

  test("streamCodeRest handles non-Error thrown object in fetch", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue("code stream network error");
    const onError = jest.fn();

    await ChatApi.streamCodeRest("prompt", undefined, "tok", jest.fn(), onError, jest.fn());

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("code stream network error");
  });

  test("handles missing onError callback gracefully", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue("network error");

    await expect(
      ChatApi.streamRest(
        "/api/v1/chat/stream",
        "conv-1",
        "Hi",
        "tok",
        jest.fn(),
        undefined as any,
        jest.fn(),
      )
    ).rejects.toThrow("onError is not a function");
  });

  test("stream ends with buffer containing non-content data", async () => {
    const tokens: string[] = [];
    const body = makeStream([
      'data: {"content":"first"}\n\n',
      'data: {"foo":"bar"}',
    ]);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });

    await ChatApi.streamRest(
      "/api/v1/chat/stream",
      "conv-1",
      "Hi",
      "tok",
      (c) => tokens.push(c),
      jest.fn(),
      jest.fn(),
    );

    expect(tokens).toEqual(["first"]);
  });
});

