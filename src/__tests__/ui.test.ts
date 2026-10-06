/**
 * @file ui.test.ts
 * @description Tests for CLI UI components — Logger, Box, TableFormatter, prompts.
 */

import { Logger } from "../ui/logger";
import { Box } from "../ui/box";
import { TableFormatter } from "../ui/table";
import { isCancel } from "../ui/prompts";

// ── Console capture ──────────────────────────────────────────────────────────

let logOutput: string[];
let errorOutput: string[];
let warnOutput: string[];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  warnOutput = [];
  console.log = (...args: unknown[]) => { logOutput.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { errorOutput.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { warnOutput.push(args.map(String).join(" ")); };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
});

// ── Logger ───────────────────────────────────────────────────────────────────

describe("Logger", () => {
  test("success prints green checkmark", () => {
    Logger.success("Done");
    expect(logOutput[0]).toContain("✓");
    expect(logOutput[0]).toContain("Done");
  });

  test("error prints red error prefix", () => {
    Logger.error("Oops");
    expect(errorOutput[0]).toContain("Error:");
    expect(errorOutput[0]).toContain("Oops");
  });

  test("info prints cyan prefix", () => {
    Logger.info("Note");
    expect(logOutput[0]).toContain("ℹ");
    expect(logOutput[0]).toContain("Note");
  });

  test("warn prints yellow warning", () => {
    Logger.warn("Caution");
    expect(warnOutput[0]).toContain("Warning:");
    expect(warnOutput[0]).toContain("Caution");
  });

  test("hint prints gray hint", () => {
    Logger.hint("Try this");
    expect(logOutput[0]).toContain("Hint:");
    expect(logOutput[0]).toContain("Try this");
  });
});

// ── Box ──────────────────────────────────────────────────────────────────────

describe("Box", () => {
  test("renders box with title and string content", () => {
    Box.render("My Title", ["Line 1", "Line 2"]);

    expect(logOutput.length).toBeGreaterThanOrEqual(5);
    expect(logOutput.some((l: string) => l.includes("My Title"))).toBe(true);
    expect(logOutput.some((l: string) => l.includes("Line 1"))).toBe(true);
  });

  test("renders box with key-value pairs", () => {
    Box.render("Info", [{ key: "Name", value: "Alice" }], { width: 50 });

    expect(logOutput.some((l: string) => l.includes("Name"))).toBe(true);
    expect(logOutput.some((l: string) => l.includes("Alice"))).toBe(true);
  });

  test("uses custom border and title colors", () => {
    Box.render("Custom", ["x"], { borderColor: "green", titleColor: "yellow" });

    expect(logOutput.length).toBeGreaterThan(0);
  });
});

// ── TableFormatter ───────────────────────────────────────────────────────────

describe("TableFormatter", () => {
  test("module exports render function", () => {
    expect(typeof TableFormatter.render).toBe("function");
  });
});

// ── prompts (isCancel) ───────────────────────────────────────────────────────

describe("isCancel", () => {
  test("returns true for symbols", () => {
    expect(isCancel(Symbol("cancel"))).toBe(true);
  });

  test("returns false for strings", () => {
    expect(isCancel("hello")).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isCancel(null)).toBe(false);
    expect(isCancel(undefined)).toBe(false);
  });
});
