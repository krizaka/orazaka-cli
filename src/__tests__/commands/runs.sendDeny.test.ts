import { runsCommand } from "../../commands/runs.command";
import { StudioApi } from "../../services/studio.api";
import * as wait from "../../services/runs.wait";

jest.mock("../../threads", () => ({ requireAuth: jest.fn() }));

const parked = { id: "run-1", studioKey: "s", status: "RUNNING", startedAt: "2026-10-30T10:00:00Z", finishedAt: null };

describe("orazaka runs send | deny | wait", () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (...args: string[]) => runsCommand.parseAsync(args, { from: "user" });

  it("registers the three commands", () => {
    expect(runsCommand.commands.map((c) => c.name())).toEqual(expect.arrayContaining(["send", "deny", "wait"]));
  });

  it("send hands the message to the run", async () => {
    const send = jest.spyOn(StudioApi, "sendRun").mockResolvedValue(parked as never);
    await run("send", "run-1", "go ahead");
    expect(send).toHaveBeenCalledWith("run-1", "go ahead");
    expect(log).toHaveBeenCalledWith("sent, the run continues (RUNNING)");
  });

  it("deny passes the reason and --json is stable", async () => {
    const deny = jest.spyOn(StudioApi, "denyRun").mockResolvedValue({ ...parked, status: "CANCELLED" } as never);
    await run("deny", "run-1", "--reason", "wrong amount", "--json");
    expect(deny).toHaveBeenCalledWith("run-1", "wrong amount");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ id: "run-1", status: "CANCELLED" });
  });

  it("deny without a reason says the run is cancelled", async () => {
    const deny = jest.spyOn(StudioApi, "denyRun").mockResolvedValue({ ...parked, status: "CANCELLED" } as never);
    await run("deny", "run-1");
    expect(deny).toHaveBeenCalledWith("run-1", undefined);
    expect(log).toHaveBeenCalledWith("denied, the run is cancelled");
  });

  it("wait reports how the run ended", async () => {
    jest.spyOn(wait, "waitForRun").mockResolvedValue({ outcome: "needs-approval", run: parked as never });
    await run("wait", "run-1");
    expect(log).toHaveBeenCalledWith("run-1 needs your approval");
  });
});
