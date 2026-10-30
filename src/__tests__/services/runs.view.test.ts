import { runsCommand } from "../../commands/runs.command";
import {
  costAgainstBudget,
  currentStep,
  elapsedSeconds,
  formatElapsed,
  normaliseRef,
  rowLine,
  sortRuns,
  timelineLines,
  toRow,
  type NamedRun,
} from "../../services/runs.view";

const run = (o: Partial<NamedRun> = {}): NamedRun => ({
  id: "11111111-2222",
  studioKey: "image-generation",
  blueprintVersion: "1.0.0",
  status: "RUNNING",
  startedAt: "2026-10-30T10:00:00Z",
  finishedAt: null,
  errorMessage: null,
  steps: [
    { stepId: "plan", ordinal: 0, jobId: null, status: "SUCCEEDED", error: null },
    { stepId: "render", ordinal: 1, jobId: "job-9", status: "RUNNING", error: null },
  ],
  outputs: [],
  ...o,
});

describe("orazaka runs (ADR-088)", () => {
  const now = new Date("2026-10-30T10:01:07Z");

  it("builds a row: name, current step, elapsed, cost against budget", () => {
    const row = toRow(run({ name: "nightly", cost: 0.4, budget: 2 }), now);
    expect(row).toMatchObject({ name: "nightly", currentStep: "render", elapsedSeconds: 67, cost: 0.4, budget: 2 });
    expect(costAgainstBudget(row)).toBe("$0.40 / $2.00");
    expect(rowLine(row)).toContain("nightly");
  });

  it("falls back to the short id and a dash when the server does not serve name or cost yet", () => {
    const row = toRow(run(), now);
    expect(row.name).toBeNull();
    expect(costAgainstBudget(row)).toBe("-");
    expect(rowLine(row)).toContain("11111111");
  });

  it("stops the clock at finishedAt", () => {
    expect(elapsedSeconds({ startedAt: "2026-10-30T10:00:00Z", finishedAt: "2026-10-30T10:00:10Z" }, now)).toBe(10);
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(9)).toBe("9s");
    expect(formatElapsed(67)).toBe("1m07s");
    expect(formatElapsed(3720)).toBe("1h02m");
  });

  it("has no current step once every step is done", () => {
    expect(currentStep([{ stepId: "a", ordinal: 0, jobId: null, status: "SUCCEEDED", error: null }])).toBeNull();
  });

  it("lists newest first", () => {
    const ordered = sortRuns([run({ id: "old", startedAt: "2026-10-29T00:00:00Z" }), run({ id: "new" })]);
    expect(ordered.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("folds the timeline to one line per step, with fan-out and errors", () => {
    const lines = timelineLines(
      run({ steps: [{ stepId: "render", ordinal: 2, jobId: "j", status: "FAILED", error: "boom" }] }),
    );
    expect(lines).toEqual(["FAILED     render #3 job j - boom"]);
  });

  it("refuses an empty reference and trims the rest", () => {
    expect(() => normaliseRef("  ")).toThrow();
    expect(normaliseRef(" nightly ")).toBe("nightly");
  });

  it("registers ls (with --watch, --json) and show (with --steps, --json)", () => {
    const ls = runsCommand.commands.find((c) => c.name() === "ls");
    const show = runsCommand.commands.find((c) => c.name() === "show");
    expect(ls?.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--watch", "--json"]));
    expect(show?.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--steps", "--json"]));
  });
});
