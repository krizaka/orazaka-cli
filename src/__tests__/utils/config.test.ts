/**
 * @file config.test.ts
 * @description Verifies the env-driven config accessors: `.env` is the single
 * source of truth, with documented fallbacks and alternative-key chains.
 */

import { intEnv, strEnv } from "../../utils/config";

describe("intEnv", () => {
  const KEY = "ORAZAKA_TEST_INT";
  const ALT = "ORAZAKA_TEST_INT_ALT";
  afterEach(() => {
    delete process.env[KEY];
    delete process.env[ALT];
  });

  test("returns the parsed env value when present", () => {
    process.env[KEY] = "8090";
    expect(intEnv(KEY, 8080)).toBe(8090);
  });

  test("falls back to the default when the key is absent", () => {
    expect(intEnv(KEY, 8080)).toBe(8080);
  });

  test("ignores a non-numeric value and uses the default", () => {
    process.env[KEY] = "not-a-number";
    expect(intEnv(KEY, 8080)).toBe(8080);
  });

  test("tries alternative keys in order", () => {
    process.env[ALT] = "5672";
    expect(intEnv([KEY, ALT], 1234)).toBe(5672);
  });
});

describe("strEnv", () => {
  const KEY = "ORAZAKA_TEST_STR";
  afterEach(() => delete process.env[KEY]);

  test("returns the env value when present", () => {
    process.env[KEY] = "http://router:8080";
    expect(strEnv(KEY, "http://localhost:8080")).toBe("http://router:8080");
  });

  test("falls back when absent or blank", () => {
    expect(strEnv(KEY, "http://localhost:8080")).toBe("http://localhost:8080");
    process.env[KEY] = "   ";
    expect(strEnv(KEY, "http://localhost:8080")).toBe("http://localhost:8080");
  });
});
