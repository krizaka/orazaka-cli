import { getRequiredTools } from "../../services/tool-installer";

describe("required tools", () => {
  test("the AI engines are optional: Ollama missing must not read as a critical failure", () => {
    const ollama = getRequiredTools().find((t) => t.name === "Ollama");
    expect(ollama).toBeDefined();
    expect(ollama?.critical).toBe(false);
    expect(ollama?.description).toMatch(/optional/i);
  });

  test("what the platform cannot start without stays critical", () => {
    const critical = getRequiredTools()
      .filter((t) => t.critical)
      .map((t) => t.name);
    expect(critical).toEqual(expect.arrayContaining(["Docker", "Docker Compose", "Java 21", "Node.js"]));
    expect(critical).not.toContain("Ollama");
  });
});
