/**
 * @file types.test.ts
 * @description Tests for CLI type definitions — discriminated unions and interface contracts.
 */

import type {
  ChatResponse,
  UserProfile,
  RegisterResult,
  NodeState,
  OperationNode,
  TimelineMessage,
  ChatInput,
} from "../types/api.types";
import type {
  CliConfig,
  ChatThread,
  StoredMessage,
} from "../types/local.types";

describe("ChatResponse", () => {
  test("required content field", () => {
    const resp: ChatResponse = { content: "Hello" };
    expect(resp.content).toBe("Hello");
  });

  test("optional conversationId and metadata", () => {
    const resp: ChatResponse = {
      content: "Hi",
      conversationId: "conv-1",
      metadata: { model: "gpt-4", tokens: 50 },
    };
    expect(resp.conversationId).toBe("conv-1");
    expect(resp.metadata?.["model"]).toBe("gpt-4");
  });
});

describe("UserProfile", () => {
  test("all fields present", () => {
    const profile: UserProfile = {
      id: "uuid-1",
      username: "admin",
      email: "a@b.com",
      authorities: ["ROLE_USER", "ROLE_ADMIN"],
      preferences: { theme: "dark" },
    };
    expect(profile.authorities).toHaveLength(2);
    expect(profile.preferences?.["theme"]).toBe("dark");
  });

  test("null preferences", () => {
    const profile: UserProfile = {
      id: "uuid-2",
      username: "guest",
      email: "g@b.com",
      authorities: [],
      preferences: null,
    };
    expect(profile.preferences).toBeNull();
  });
});

describe("RegisterResult", () => {
  test("success case", () => {
    const result: RegisterResult = {
      user: {
        id: "uuid-1",
        username: "new",
        email: "n@b.com",
        authorities: [],
        preferences: null,
      },
      error: null,
    };
    expect(result.user).not.toBeNull();
    expect(result.error).toBeNull();
  });

  test("failure case", () => {
    const result: RegisterResult = {
      user: null,
      error: "Email already exists",
    };
    expect(result.user).toBeNull();
    expect(result.error).toBe("Email already exists");
  });
});

describe("NodeState discriminated union", () => {
  test("ACTIVE state", () => {
    const state: NodeState = { type: "ACTIVE" };
    expect(state.type).toBe("ACTIVE");
  });

  test("LOCKED state with reason", () => {
    const state: NodeState = {
      type: "LOCKED",
      reason: "Rate limit exceeded",
      lockedAt: "2026-01-01T00:00:00Z",
    };
    expect(state.type).toBe("LOCKED");
    if (state.type === "LOCKED") {
      expect(state.reason).toBe("Rate limit exceeded");
    }
  });

  test("INVISIBLE state", () => {
    const state: NodeState = { type: "INVISIBLE" };
    expect(state.type).toBe("INVISIBLE");
  });
});

describe("TimelineMessage discriminated union", () => {
  test("text message", () => {
    const msg: TimelineMessage = { kind: "text", content: "Hello" };
    expect(msg.kind).toBe("text");
  });

  test("image message", () => {
    const msg: TimelineMessage = { kind: "image", content: "data:image/png;base64,abc" };
    expect(msg.kind).toBe("image");
  });

  test("audio message", () => {
    const msg: TimelineMessage = { kind: "audio", content: "data:audio/mp3;base64,abc" };
    expect(msg.kind).toBe("audio");
  });

  test("video message", () => {
    const msg: TimelineMessage = { kind: "video", content: "data:video/mp4;base64,abc" };
    expect(msg.kind).toBe("video");
  });

  test("exhaustive switch coverage", () => {
    const messages: TimelineMessage[] = [
      { kind: "text", content: "a" },
      { kind: "image", content: "b" },
      { kind: "audio", content: "c" },
      { kind: "video", content: "d" },
    ];
    const kinds = messages.map((m) => {
      switch (m.kind) {
        case "text": return "T";
        case "image": return "I";
        case "audio": return "A";
        case "video": return "V";
      }
    });
    expect(kinds).toEqual(["T", "I", "A", "V"]);
  });
});

describe("ChatInput", () => {
  test("text-only input", () => {
    const input: ChatInput = { prompt: "What is AI?" };
    expect(input.flag).toBeUndefined();
    expect(input.prompt).toBe("What is AI?");
  });

  test("flagged input", () => {
    const input: ChatInput = {
      flag: "--gen-image",
      flagValue: "A sunset",
      prompt: "",
    };
    expect(input.flag).toBe("--gen-image");
  });
});

describe("CliConfig", () => {
  test("full config", () => {
    const config: CliConfig = {
      token: "jwt-abc",
      username: "admin",
      activeThreadId: "thread-1",
      threads: [
        { conversationId: "thread-1", title: "First", updatedAt: 1700000000000 },
      ],
    };
    expect(config.threads).toHaveLength(1);
    expect(config.token).toBe("jwt-abc");
  });
});
