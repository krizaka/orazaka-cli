/**
 * @file cinema-sheet-file.test.ts
 * @description A character id from the script never leaves the production's sheets folder.
 */
import path from "node:path";
import { sheetFile } from "../commands/cinema.command";

describe("sheetFile", () => {
  test("a plain id lands in sheets/", () => {
    expect(sheetFile("prod", "hero-1")).toBe(path.join("prod", "sheets", "hero-1.png"));
  });
  test.each(["../../etc/x", "a/b", "a\\b", "", ".."])("refuses %j", (id) => {
    expect(() => sheetFile("prod", id)).toThrow(/safe file name/);
  });
});
