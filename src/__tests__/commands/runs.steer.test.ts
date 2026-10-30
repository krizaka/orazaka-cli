import { runsCommand } from "../../commands/runs.command";
import { StudioApi } from "../../services/studio.api";

jest.mock("../../threads", () => ({ requireAuth: jest.fn() }));

describe("orazaka runs stop | approve | resume", () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (...args: string[]) => runsCommand.parseAsync(args, { from: "user" });

  it("registers the steering commands", () => {
    expect(runsCommand.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["ls", "show", "stop", "approve", "resume"]),
    );
  });

  it("stop cancels the run it names", async () => {
    const cancel = jest.spyOn(StudioApi, "cancelRun").mockResolvedValue();
    await run("stop", "run-1");
    expect(cancel).toHaveBeenCalledWith("run-1");
    expect(log).toHaveBeenCalledWith("stopped");
  });

  it("approve resolves the approval step and --json is stable", async () => {
    const approve = jest.spyOn(StudioApi, "approveRun").mockResolvedValue();
    await run("approve", "run-2", "--json");
    expect(approve).toHaveBeenCalledWith("run-2");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ id: "run-2", action: "approve", result: null });
  });

  it("resume needs --from and sends it", async () => {
    const resume = jest.spyOn(StudioApi, "resumeRun").mockResolvedValue({ id: "run-3", status: "RUNNING" } as never);
    await run("resume", "run-1", "--from", "render");
    expect(resume).toHaveBeenCalledWith("run-1", "render");
  });
});
