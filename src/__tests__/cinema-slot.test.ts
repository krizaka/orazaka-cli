/**
 * @file cinema-slot.test.ts
 * @description A production waits for a free slot of the account's concurrent-run cap instead of failing (ADR-080).
 */
import { startWhenFree } from "../commands/cinema.command";

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

  test("any other refusal is thrown at once", async () => {
    const failing = startWhenFree(async () => {
      throw new Error("No such studio: x");
    }, async () => undefined);
    await expect(failing).rejects.toThrow("No such studio");
  });
});
