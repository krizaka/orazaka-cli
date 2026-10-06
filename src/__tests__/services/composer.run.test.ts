import { CAPABILITY, firstOutput, runComposerStudio } from "../../services/composer.run";
import { StudioApi, type ComposerStudioResponse, type RunResponse } from "../../services/studio.api";

jest.mock("../../services/studio.api", () => ({
  StudioApi: {
    composer: jest.fn(),
    startStudioRun: jest.fn(),
    runDetail: jest.fn(),
  },
}));

const composer = StudioApi.composer as jest.Mock;
const startStudioRun = StudioApi.startStudioRun as jest.Mock;
const runDetail = StudioApi.runDetail as jest.Mock;

const entry = (overrides: Partial<ComposerStudioResponse> = {}): ComposerStudioResponse => ({
  studioKey: "image-generation",
  label: "Image generation",
  iconKey: "image",
  version: "1.0.0",
  capabilityKey: CAPABILITY.image,
  inputKey: "prompt",
  inputKind: "TEXT",
  promptKey: "prompt",
  available: true,
  lockedReason: "NONE",
  ...overrides,
});

const run = (overrides: Partial<RunResponse> = {}): RunResponse =>
  ({
    id: "run-1",
    studioKey: "image-generation",
    blueprintVersion: "1.0.0",
    status: "SUCCEEDED",
    startedAt: "2026-09-17T10:00:00Z",
    finishedAt: "2026-09-17T10:01:07Z",
    errorMessage: null,
    steps: [],
    outputs: [{ key: "image", label: "Image", type: "IMAGE", value: "/api/v1/assets/j/i.png" }],
    ...overrides,
  }) as RunResponse;

/**
 * The CLI's door (ADR-068 §4).
 *
 * `media.api.ts` held five POSTs to `/api/v1/media/**`, which reached the job plane with
 * no run behind them. What replaced it asks the platform which Studio runs a capability
 * here, starts a run, and reads the artefact the blueprint declared.
 */
describe("runComposerStudio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    composer.mockResolvedValue([entry()]);
    startStudioRun.mockResolvedValue(run({ status: "RUNNING" }));
    runDetail.mockResolvedValue(run());
  });

  test("asks the platform which Studio runs the capability, then starts a run of it", async () => {
    const finished = await runComposerStudio({
      capabilityKey: CAPABILITY.image,
      primary: "un atelier de menuiserie",
    });

    expect(composer).toHaveBeenCalled();
    expect(startStudioRun).toHaveBeenCalledWith("image-generation", {
      prompt: "un atelier de menuiserie",
    });
    expect(firstOutput(finished)).toBe("/api/v1/assets/j/i.png");
  });

  test("puts an uploaded asset in the input the Studio declared holds one", async () => {
    composer.mockResolvedValue([
      entry({
        studioKey: "image-analysis",
        capabilityKey: CAPABILITY.vision,
        inputKey: "assetId",
        inputKind: "ASSET",
        promptKey: "prompt",
      }),
    ]);

    await runComposerStudio({
      capabilityKey: CAPABILITY.vision,
      primary: "asset-1",
      prompt: "combien de fenêtres ?",
    });

    expect(startStudioRun).toHaveBeenCalledWith("image-analysis", {
      assetId: "asset-1",
      prompt: "combien de fenêtres ?",
    });
  });

  test("a capability no installed Studio runs is a named refusal, not a 404 from a POST", async () => {
    composer.mockResolvedValue([]);

    await expect(
      runComposerStudio({ capabilityKey: CAPABILITY.video, primary: "un plan large" }),
    ).rejects.toThrow(/No Studio installed here runs orazaka\.core\.media\.video/);
    expect(startStudioRun).not.toHaveBeenCalled();
  });

  test("a locked Studio says what is missing before anything is charged", async () => {
    composer.mockResolvedValue([entry({ available: false, lockedReason: "REQUIRES_PLAN" })]);

    await expect(
      runComposerStudio({ capabilityKey: CAPABILITY.image, primary: "x" }),
    ).rejects.toThrow(/REQUIRES_PLAN/);
    expect(startStudioRun).not.toHaveBeenCalled();
  });

  test("a failed run surfaces the run's own error, not a job's", async () => {
    runDetail.mockResolvedValue(run({ status: "FAILED", errorMessage: "the accelerator is busy" }));

    await expect(
      runComposerStudio({ capabilityKey: CAPABILITY.image, primary: "x" }),
    ).rejects.toThrow("the accelerator is busy");
  });

  test("a parked run points at where the answer is given rather than polling forever", async () => {
    runDetail.mockResolvedValue(run({ status: "AWAITING_INPUT" }));

    await expect(
      runComposerStudio({ capabilityKey: CAPABILITY.image, primary: "x" }),
    ).rejects.toThrow(/waiting for an answer/);
  });
});
