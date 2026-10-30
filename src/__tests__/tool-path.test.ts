import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { toolPath } from "../services/tool-path";
import { firstFrameArgs, writeTreatmentFiles } from "../services/cinema.treatment";

describe("toolPath", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-tools-"));
  const tool = path.join(dir, "mytool");
  fs.writeFileSync(tool, "#!/bin/sh\n", { mode: 0o755 });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns the absolute path found in a trusted folder", () => {
    expect(toolPath("mytool", [dir])).toBe(tool);
  });

  it("never searches PATH and throws when the tool is absent", () => {
    expect(() => toolPath("mytool", ["/nonexistent-folder"])).toThrow(/not found/);
  });

  it("refuses anything that is not a bare program name", () => {
    expect(() => toolPath("../bin/sh", [dir])).toThrow(/not a program name/);
    expect(() => toolPath("a b", [dir])).toThrow(/not a program name/);
  });
});

describe("firstFrameArgs", () => {
  it("keeps a leading dash from becoming an option", () => {
    const args = firstFrameArgs("-take.mp4", "-out.png");
    expect(args).toEqual(["-v", "error", "-y", "-i", "./-take.mp4", "-frames:v", "1", "./-out.png"]);
  });
});

describe("writeTreatmentFiles", () => {
  it("writes the treatment and its critique into the folder", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-treat-")), "out");
    const draft = { treatment: { a: 1 }, rubric: { r: 1 }, judge: null, verdict: { pass: true }, runs: 2 };
    const written = writeTreatmentFiles(dir, draft);
    expect(JSON.parse(fs.readFileSync(written.treatment, "utf8"))).toEqual({ a: 1 });
    expect(JSON.parse(fs.readFileSync(written.critique, "utf8"))).toEqual({
      rubric: { r: 1 },
      judge: null,
      verdict: { pass: true },
      runs: 2,
    });
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });
});
