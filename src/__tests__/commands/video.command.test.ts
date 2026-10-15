import { videoRunOptions } from "../../commands/video.command";

describe("orazaka video — the options it sends to the Studio", () => {
  it("sends the choices, and nothing the Studio defaults for", () => {
    expect(videoRunOptions({ duration: "5", model: "wan2-2-t2v-a14b", aspect: "16:9", seed: "20261011" })).toEqual({
      durationSeconds: 5,
      model: "wan2-2-t2v-a14b",
      aspect: "16:9",
      seed: "20261011",
    });
    expect(videoRunOptions({})).toEqual({ durationSeconds: 4, model: undefined, aspect: undefined, seed: undefined });
  });

  it("refuses an aspect or a seed it can tell is wrong, before any run is started", () => {
    expect(() => videoRunOptions({ aspect: "4:3" })).toThrow(/9:16, 16:9, 1:1/);
    expect(() => videoRunOptions({ seed: "abc" })).toThrow(/whole number/);
    expect(() => videoRunOptions({ seed: "-1" })).toThrow(/whole number/);
  });
});
