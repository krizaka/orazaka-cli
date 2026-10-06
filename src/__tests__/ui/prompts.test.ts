/**
 * @file prompts.test.ts
 * @description Tests for prompts.ts using jest.isolateModules() for clean
 * module isolation — prevents cross-test cache contamination.
 */

// ── Build the mock @clack/prompts ────────────────────────────────────────────

const mockIntro = jest.fn();
const mockOutro = jest.fn();
const mockText = jest.fn();
const mockPassword = jest.fn();
const mockSelect = jest.fn();
const mockMultiselect = jest.fn();
const mockConfirm = jest.fn();
const mockNote = jest.fn();
const mockLogMessage = jest.fn();
const mockLogStep = jest.fn();
const mockLogSuccess = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockLogInfo = jest.fn();

const mockSpinner = jest.fn(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  message: jest.fn(),
}));

type ClackPrompts = typeof import(
  "@clack/prompts",
  { with: { "resolution-mode": "import" } }
);

const mockModule = {
  intro: mockIntro,
  outro: mockOutro,
  text: mockText,
  password: mockPassword,
  select: mockSelect,
  multiselect: mockMultiselect,
  confirm: mockConfirm,
  note: mockNote,
  log: {
    message: mockLogMessage,
    step: mockLogStep,
    success: mockLogSuccess,
    warn: mockLogWarn,
    error: mockLogError,
    info: mockLogInfo,
  },
  spinner: mockSpinner,
  isCancel: (v: unknown): v is symbol => typeof v === "symbol",
} as unknown as ClackPrompts;

// ── Helper: get isolated module with injected mock ───────────────────────────

function getIsolatedPrompts() {
  let mod: typeof import("../../ui/prompts");

  jest.isolateModules(() => {
    mod = require("../../ui/prompts");
  });

  mod!._setTestLoader(async () => mockModule);
  return mod!;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── intro ────────────────────────────────────────────────────────────────────

describe("intro", () => {
  test("delegates to @clack/prompts intro", async () => {
    const { intro } = getIsolatedPrompts();
    await intro("Welcome");
    expect(mockIntro).toHaveBeenCalledWith("Welcome");
  });
});

// ── outro ────────────────────────────────────────────────────────────────────

describe("outro", () => {
  test("delegates to @clack/prompts outro", async () => {
    const { outro } = getIsolatedPrompts();
    await outro("Goodbye");
    expect(mockOutro).toHaveBeenCalledWith("Goodbye");
  });
});

// ── text ─────────────────────────────────────────────────────────────────────

describe("text", () => {
  test("delegates with options", async () => {
    mockText.mockResolvedValue("user-input");
    const { text } = getIsolatedPrompts();
    const result = await text({ message: "Enter name" });

    expect(mockText).toHaveBeenCalledWith({ message: "Enter name" });
    expect(result).toBe("user-input");
  });

  test("passes placeholder and validate", async () => {
    const validate = (v: string) => (v.length < 3 ? "Too short" : undefined);
    mockText.mockResolvedValue("abc");
    const { text } = getIsolatedPrompts();

    await text({ message: "Name", placeholder: "John", validate });

    expect(mockText).toHaveBeenCalledWith({
      message: "Name",
      placeholder: "John",
      validate,
    });
  });
});

// ── password ─────────────────────────────────────────────────────────────────

describe("password", () => {
  test("delegates to @clack/prompts password", async () => {
    mockPassword.mockResolvedValue("secret123");
    const { password } = getIsolatedPrompts();
    const result = await password({ message: "Enter password" });

    expect(mockPassword).toHaveBeenCalledWith({ message: "Enter password" });
    expect(result).toBe("secret123");
  });
});

// ── createSpinner ────────────────────────────────────────────────────────────

describe("createSpinner", () => {
  test("returns spinner with start/stop/message", async () => {
    const { createSpinner } = getIsolatedPrompts();
    const spinner = await createSpinner();

    expect(spinner).toHaveProperty("start");
    expect(spinner).toHaveProperty("stop");
    expect(spinner).toHaveProperty("message");
    expect(typeof spinner.start).toBe("function");
  });
});

// ── isCancel ─────────────────────────────────────────────────────────────────

describe("isCancel", () => {
  test("returns true for symbols", () => {
    const { isCancel } = getIsolatedPrompts();
    expect(isCancel(Symbol("cancel"))).toBe(true);
  });

  test("returns false for strings", () => {
    const { isCancel } = getIsolatedPrompts();
    expect(isCancel("hello")).toBe(false);
  });

  test("returns false for null and undefined", () => {
    const { isCancel } = getIsolatedPrompts();
    expect(isCancel(null)).toBe(false);
    expect(isCancel(undefined)).toBe(false);
  });

  test("returns false for numbers", () => {
    const { isCancel } = getIsolatedPrompts();
    expect(isCancel(42)).toBe(false);
  });
});

// ── select ───────────────────────────────────────────────────────────────────

describe("select", () => {
  test("delegates to @clack/prompts select", async () => {
    mockSelect.mockResolvedValue("opt1");
    const { select } = getIsolatedPrompts();
    const result = await select({
      message: "Choose",
      options: [{ value: "opt1", label: "Option 1" }],
    });

    expect(mockSelect).toHaveBeenCalledWith({
      message: "Choose",
      options: [{ value: "opt1", label: "Option 1" }],
    });
    expect(result).toBe("opt1");
  });
});

// ── multiselect ──────────────────────────────────────────────────────────────

describe("multiselect", () => {
  test("delegates to @clack/prompts multiselect", async () => {
    mockMultiselect.mockResolvedValue(["opt1", "opt2"]);
    const { multiselect } = getIsolatedPrompts();
    const result = await multiselect({
      message: "Choose multiple",
      options: [
        { value: "opt1", label: "Option 1" },
        { value: "opt2", label: "Option 2" },
      ],
    });

    expect(mockMultiselect).toHaveBeenCalledWith({
      message: "Choose multiple",
      options: [
        { value: "opt1", label: "Option 1" },
        { value: "opt2", label: "Option 2" },
      ],
    });
    expect(result).toEqual(["opt1", "opt2"]);
  });
});

// ── confirm ──────────────────────────────────────────────────────────────────

describe("confirm", () => {
  test("delegates to @clack/prompts confirm", async () => {
    mockConfirm.mockResolvedValue(true);
    const { confirm } = getIsolatedPrompts();
    const result = await confirm({ message: "Yes/No?" });

    expect(mockConfirm).toHaveBeenCalledWith({ message: "Yes/No?" });
    expect(result).toBe(true);
  });
});

// ── note ─────────────────────────────────────────────────────────────────────

describe("note", () => {
  test("delegates to @clack/prompts note", async () => {
    const { note } = getIsolatedPrompts();
    await note("Some note", "Title");

    expect(mockNote).toHaveBeenCalledWith("Some note", "Title");
  });
});

// ── log functions ────────────────────────────────────────────────────────────

describe("log functions", () => {
  test("log delegates to log.message", async () => {
    const { log } = getIsolatedPrompts();
    await log("Hello log");
    expect(mockLogMessage).toHaveBeenCalledWith("Hello log");
  });

  test("logStep delegates to log.step", async () => {
    const { logStep } = getIsolatedPrompts();
    await logStep("Step 1");
    expect(mockLogStep).toHaveBeenCalledWith("Step 1");
  });

  test("logSuccess delegates to log.success", async () => {
    const { logSuccess } = getIsolatedPrompts();
    await logSuccess("Success!");
    expect(mockLogSuccess).toHaveBeenCalledWith("Success!");
  });

  test("logWarning delegates to log.warn", async () => {
    const { logWarning } = getIsolatedPrompts();
    await logWarning("Warning!");
    expect(mockLogWarn).toHaveBeenCalledWith("Warning!");
  });

  test("logError delegates to log.error", async () => {
    const { logError } = getIsolatedPrompts();
    await logError("Error!");
    expect(mockLogError).toHaveBeenCalledWith("Error!");
  });

  test("logInfo delegates to log.info", async () => {
    const { logInfo } = getIsolatedPrompts();
    await logInfo("Info!");
    expect(mockLogInfo).toHaveBeenCalledWith("Info!");
  });
});

// ── handleCancel ─────────────────────────────────────────────────────────────

describe("handleCancel", () => {
  let originalExit: typeof process.exit;
  let originalLog: typeof console.log;
  let exitMock: jest.Mock;
  let logMock: jest.Mock;

  beforeAll(() => {
    originalExit = process.exit;
    originalLog = console.log;
    exitMock = jest.fn();
    logMock = jest.fn();
    process.exit = exitMock as any;
    console.log = logMock;
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  test("does nothing if value is not a cancel symbol", () => {
    const { handleCancel } = getIsolatedPrompts();
    handleCancel("some value");
    expect(exitMock).not.toHaveBeenCalled();
  });

  test("prints message and exits process if value is a cancel symbol", () => {
    const { handleCancel } = getIsolatedPrompts();
    handleCancel(Symbol("cancel"), "custom cancellation msg");
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(logMock).toHaveBeenCalledWith("custom cancellation msg");
  });

  test("prints default message and exits process if value is a cancel symbol and no message is provided", () => {
    const { handleCancel } = getIsolatedPrompts();
    handleCancel(Symbol("cancel"));
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(logMock).toHaveBeenCalledWith("Operation cancelled.");
  });
});

// ── _resetLoader ─────────────────────────────────────────────────────────────

describe("_resetLoader", () => {
  test("resets loader function without error", () => {
    const { _resetLoader } = getIsolatedPrompts();
    expect(() => _resetLoader()).not.toThrow();
  });
});
