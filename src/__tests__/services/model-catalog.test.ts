/**
 * @file model-catalog.test.ts
 * @description The catalogue helpers run one validated statement through psql in the database
 * container, and refuse to make default a model the catalogue does not hold.
 */

import { execFileSync } from "node:child_process";
import { defaultImageModel, queryCatalog, setDefaultImageModel } from "../../services/model-catalog";

jest.mock("node:child_process", () => ({ execFileSync: jest.fn() }));
const psql = execFileSync as unknown as jest.Mock;

afterEach(() => psql.mockReset());

test("queryCatalog splits psql's unaligned rows and passes the statement as one argument", () => {
  psql.mockReturnValue("flux-2-klein-4b|t\nz-image-turbo|f\n");

  expect(queryCatalog("SELECT 1", { DB_NAME: "db", DB_USERNAME: "u" })).toEqual([
    ["flux-2-klein-4b", "t"],
    ["z-image-turbo", "f"],
  ]);
  const args = psql.mock.calls[0][1] as string[];
  expect(args).toEqual(expect.arrayContaining(["-U", "u", "-d", "db", "-c", "SELECT 1"]));
});

test("defaultImageModel returns the catalogue's default, or undefined", () => {
  psql.mockReturnValueOnce("flux-2-klein-4b\n").mockReturnValueOnce("");
  expect(defaultImageModel({})).toBe("flux-2-klein-4b");
  expect(defaultImageModel({})).toBeUndefined();
});

test("setDefaultImageModel refuses a name that is not a model name", () => {
  expect(() => setDefaultImageModel("x'; DROP TABLE orazaka_models; --", {})).toThrow(
    /Not a catalogue model name/,
  );
  expect(psql).not.toHaveBeenCalled();
});

test("setDefaultImageModel fails when the catalogue has no such image row", () => {
  psql.mockReturnValue("");
  expect(() => setDefaultImageModel("flux-2-klein-4b", {})).toThrow(/has no image model/);
});

test("setDefaultImageModel makes exactly one image model the default", () => {
  psql.mockReturnValue("flux-2-klein-4b\nz-image-turbo\n");
  setDefaultImageModel("flux-2-klein-4b", {});
  const sql = (psql.mock.calls[0][1] as string[]).at(-1);
  expect(sql).toContain("SET is_default = (model_name = 'flux-2-klein-4b') WHERE category = 'image'");
});
