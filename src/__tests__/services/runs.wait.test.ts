import { StudioApi } from "../../services/studio.api";
import { outcomeOf, waitForRun } from "../../services/runs.wait";
import { notifyCommand, outcomeMessage } from "../../services/notify";

const at = (status: string) => ({ id: "r", status }) as never;

describe("waitForRun", () => {
  afterEach(() => jest.restoreAllMocks());

  it("maps the statuses that end or park a run", () => {
    expect(outcomeOf("SUCCEEDED")).toBe("finished");
    expect(outcomeOf("FAILED")).toBe("failed");
    expect(outcomeOf("CANCELLED")).toBe("cancelled");
    expect(outcomeOf("AWAITING_INPUT")).toBe("needs-approval");
    expect(outcomeOf("RUNNING")).toBeNull();
  });

  it("polls until the run ends and reports each distinct status once", async () => {
    const detail = jest
      .spyOn(StudioApi, "runDetail")
      .mockResolvedValueOnce(at("RUNNING"))
      .mockResolvedValueOnce(at("RUNNING"))
      .mockResolvedValueOnce(at("SUCCEEDED"));
    const seen: string[] = [];
    const sleep = jest.fn().mockResolvedValue(undefined);
    const result = await waitForRun("r", { onStatus: (s) => seen.push(s), sleep });
    expect(result.outcome).toBe("finished");
    expect(detail).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["RUNNING", "SUCCEEDED"]);
  });

  it("stops at an approval gate", async () => {
    jest.spyOn(StudioApi, "runDetail").mockResolvedValue(at("AWAITING_INPUT"));
    expect((await waitForRun("r", { sleep: jest.fn() })).outcome).toBe("needs-approval");
  });
});

describe("notify", () => {
  it("passes the text through argv on macOS, never into the script", () => {
    const command = notifyCommand("darwin", "Orazaka", 'x" & do shell script "evil');
    expect(command?.file).toBe("osascript");
    expect(command?.args.slice(-2)).toEqual(["Orazaka", 'x" & do shell script "evil']);
    expect(command?.args.filter((a) => a.includes("evil"))).toHaveLength(1);
  });

  it("uses notify-send on Linux and nothing elsewhere", () => {
    expect(notifyCommand("linux", "t", "m")).toEqual({ file: "notify-send", args: ["t", "m"] });
    expect(notifyCommand("win32", "t", "m")).toBeNull();
  });

  it("words each outcome", () => {
    expect(outcomeMessage("finished", "n")).toBe("n finished");
    expect(outcomeMessage("needs-approval", "n")).toBe("n needs your approval");
  });
});
