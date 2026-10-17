/**
 * @file cinema-slot.test.ts
 * @description A production waits for a free slot of the account's concurrent-run cap instead of failing (ADR-080).
 */
import { isAssetId, startWhenFree } from "../commands/cinema.command";

describe("startWhenFree", () => {
  test("a busy account is waited for, then the run starts", async () => {
    let calls = 0;
    const waits: number[] = [];
    const run = await startWhenFree(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("too many concurrent runs: 2 of 2 already running");
        return "run-1";
      },
      async (ms) => {
        waits.push(ms);
      },
      60_000,
      10,
    );
    expect(run).toBe("run-1");
    expect(waits).toEqual([10, 10]);
  });

  test("a platform restarting (5xx) is waited for too", async () => {
    let calls = 0;
    const run = await startWhenFree(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Internal Server Error");
      return "run-2";
    }, async () => undefined, 60_000, 10);
    expect(run).toBe("run-2");
  });

  test("any other refusal is thrown at once", async () => {
    const failing = startWhenFree(async () => {
      throw new Error("No such studio: x");
    }, async () => undefined);
    await expect(failing).rejects.toThrow("No such studio");
  });
});

describe("isAssetId", () => {
  test("an uploaded asset's id is used as it is, a run's output URL is not one", () => {
    expect(isAssetId("0b6f2a52-1c1e-4c84-9a8e-2f6b2b1d9a10")).toBe(true);
    expect(isAssetId("/api/v1/assets/0b6f2a52-1c1e-4c84-9a8e-2f6b2b1d9a10/image.png")).toBe(false);
  });
});
