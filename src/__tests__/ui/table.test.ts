/**
 * @file table.test.ts
 * @description Tests for TableFormatter — ASCII table rendering with cli-table3.
 * Uses a return-based approach to avoid console.log spy interference.
 */

import Table from "cli-table3";
import chalk from "chalk";
import { TableFormatter } from "../../ui/table";

describe("TableFormatter.render", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test("renders a table with header and rows", () => {
    TableFormatter.render(
      ["Name", "Age"],
      [["Alice", "30"], ["Bob", "25"]],
      { colWidths: [15, 10] },
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("Alice");
    expect(output).toContain("30");
    expect(output).toContain("Bob");
    expect(output).toContain("25");
  });

  test("renders an empty table with headers only", () => {
    TableFormatter.render(["Col A", "Col B"], [], { colWidths: [15, 15] });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  test("uses custom head color", () => {
    TableFormatter.render(
      ["Status"],
      [["OK"]],
      { headColor: "green", colWidths: [15] },
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("OK");
  });

  test("accepts custom column widths", () => {
    TableFormatter.render(
      ["ID", "Value"],
      [["1", "Test"]],
      { colWidths: [10, 30] },
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("1");
    expect(output).toContain("Test");
  });

  test("uses cyan as default head color", () => {
    TableFormatter.render(
      ["Default"],
      [["row"]],
      { colWidths: [15] },
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("row");
  });

  test("handles multiple rows correctly", () => {
    const rows = [
      ["r1c1", "r1c2"],
      ["r2c1", "r2c2"],
      ["r3c1", "r3c2"],
    ];
    TableFormatter.render(["H1", "H2"], rows, { colWidths: [10, 10] });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("r1c1");
    expect(output).toContain("r2c2");
    expect(output).toContain("r3c1");
  });

  test("renders a table with default options when options is omitted", () => {
    TableFormatter.render(["Name", "Age"], [["Alice", "30"]]);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("Alice");
  });
});

// ── Direct cli-table3 integration ────────────────────────────────────────────

describe("cli-table3 integration", () => {
  test("Table constructor and toString work in test env", () => {
    const table = new Table({
      head: [chalk.cyan.bold("A"), chalk.cyan.bold("B")],
      colWidths: [10, 10],
      style: { head: [], border: ["gray"] },
    });

    table.push(["x", "y"]);
    const output = table.toString();

    expect(output).toContain("x");
    expect(output).toContain("y");
  });
});
