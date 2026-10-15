import * as fs from "node:fs";
import * as path from "node:path";
import { NODE_MIN_MAJOR } from "../utils/config";
import { PREREQUISITES } from "../commands/onboard.command";
import { getRequiredTools } from "../services/tool-installer";

const root = path.resolve(__dirname, "..", "..");

describe("one Node.js minimum, everywhere", () => {
  test("package.json engines, CI, README and the checks all say the same major", () => {
    const engines = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).engines.node as string;
    expect(engines).toBe(`>=${String(NODE_MIN_MAJOR)}`);

    const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf-8");
    expect([...ci.matchAll(/node-version:\s*"?(\d+)"?/g)].map((m) => Number(m[1]))).toContain(NODE_MIN_MAJOR);

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");
    expect(readme).toContain(`Node.js ${String(NODE_MIN_MAJOR)}+`);
  });

  test("`orazaka onboard` accepts the minimum the CLI declares (a Node 22 machine passes)", () => {
    const node = PREREQUISITES.find((p) => p.name === "Node.js");
    expect(node?.minMajor).toBe(NODE_MIN_MAJOR);
  });

  test("`orazaka install` checks the same version", () => {
    const node = getRequiredTools().find((t) => t.name === "Node.js");
    expect(node?.minVersion).toBe(`${String(NODE_MIN_MAJOR)}.0.0`);
  });
});
