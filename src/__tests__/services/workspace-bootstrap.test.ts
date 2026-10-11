import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapWorkspace, WORKSPACE_REPOSITORY, type Runner } from "../../services/workspace-bootstrap";
import { WORKSPACE_MANIFEST } from "../../utils/platform";

describe("bootstrapWorkspace", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-bootstrap-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function recorder(status = 0): { calls: string[][]; run: Runner } {
    const calls: string[][] = [];
    return { calls, run: (cmd, args, cwd) => (calls.push([cmd, ...args, `@${cwd}`]), { status, error: undefined }) };
  }

  test("clones the workspace repository, then every component at its path", () => {
    const target = path.join(dir, "orazaka");
    const { calls, run } = recorder();

    const result = bootstrapWorkspace(target, { depth: 1, run });

    expect(result).toEqual({ ok: true, root: target });
    expect(calls).toEqual([
      ["git", "clone", "--depth", "1", WORKSPACE_REPOSITORY, target, `@${dir}`],
      [process.execPath, path.join("scripts", "workspace.mjs"), "clone", "--depth", "1", `@${target}`],
    ]);
  });

  test("reuses a directory that already holds a workspace", () => {
    fs.writeFileSync(path.join(dir, WORKSPACE_MANIFEST), "{}");
    const { calls, run } = recorder();

    expect(bootstrapWorkspace(dir, { run }).ok).toBe(true);
    expect(calls.map((c) => c[0])).toEqual([process.execPath]);
  });

  test("never clones into a non-empty directory", () => {
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    const { calls, run } = recorder();

    const result = bootstrapWorkspace(dir, { run });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not empty");
    expect(calls).toEqual([]);
  });

  test("reports a failed clone", () => {
    const { run } = recorder(128);
    const result = bootstrapWorkspace(path.join(dir, "orazaka"), { run });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("git clone failed");
  });
});
