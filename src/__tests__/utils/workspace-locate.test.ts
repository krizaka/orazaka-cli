import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findWorkspaceManifestRoot, locateWorkspace, WORKSPACE_MANIFEST } from "../../utils/platform";

describe("locateWorkspace", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-locate-")));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("finds the manifest above the current directory", () => {
    const deep = path.join(dir, "orazaka-apps", "ui");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(dir, WORKSPACE_MANIFEST), "{}");
    expect(findWorkspaceManifestRoot(deep)).toBe(dir);
    expect(locateWorkspace(deep, path.join(dir, "elsewhere"))).toBe(dir);
  });

  test("falls back on the workspace the CLI itself sits in", () => {
    const workspace = path.join(dir, "ws");
    const cliDir = path.join(workspace, "orazaka-apps", "ui", "orazaka-cli", "dist", "utils");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(workspace, WORKSPACE_MANIFEST), "{}");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    expect(locateWorkspace(outside, cliDir)).toBe(workspace);
  });

  test("is null outside any workspace — the CLI installed from npm, run from an empty directory", () => {
    expect(locateWorkspace(dir, dir)).toBeNull();
  });
});
