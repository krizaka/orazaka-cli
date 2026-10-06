import { installCommand } from "../../commands/install.command";
import * as fs from "node:fs";
import { select, text, createSpinner } from "../../ui/prompts";
import { mergeEnvFile } from "../../ui/platform";

jest.mock("node:fs");
jest.mock("../../ui/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  select: jest.fn(),
  text: jest.fn(),
  note: jest.fn(),
  createSpinner: jest.fn(),
  handleCancel: jest.fn(),
  logStep: jest.fn(),
  logSuccess: jest.fn(),
  logWarning: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("../../ui/platform", () => ({
  resolveWorkspaceRoot: jest.fn(() => "/mock/workspace"),
  resolveEnvFile: jest.fn(() => "/mock/workspace/.env"),
  writeEnvFile: jest.fn(),
  mergeEnvFile: jest.fn(() => []),
  hasTool: jest.fn(() => false),
  ensureDir: jest.fn(),
  parseEnvFile: jest.fn(() => ({})),
  isAppleSilicon: jest.fn(() => false),
  detectOrazakaWorkspace: jest.fn(() => ({ isWorkspace: true, root: "/mock/workspace", markers: ["pom.xml"], missing: [] })),
  getToolVersion: jest.fn(() => "Installed"),
  getSystemInfo: jest.fn(() => ({ platform: "darwin", arch: "arm64", cpuModel: "Test", totalMemoryGb: 16, nodeVersion: "v20.0.0", isAppleSilicon: false, hostname: "mock" })),
  resolveComposeFile: jest.fn(() => "/mock/workspace/infra/docker-compose.yml"),
  resolveDockerComposeCmd: jest.fn(() => "docker compose"),
}));

describe("install command", () => {
  let mockSpinner: { start: jest.Mock; stop: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpinner = {
      start: jest.fn(),
      stop: jest.fn(),
    };
    (createSpinner as jest.Mock).mockResolvedValue(mockSpinner);
  });

  test("generates Local Dev + Bundled config correctly", async () => {
    (select as jest.Mock)
      .mockResolvedValueOnce("local_dev") // targetEnv
      .mockResolvedValueOnce("bundled"); // infraMode

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      "SPRING_AI_OLLAMA_BASE_URL=http://localhost:11434"
    );

    await installCommand.parseAsync(["node", "install"]);

    // Verify .env reconciliation is NON-destructive: install merges (adds missing
    // keys) rather than overwriting existing developer values.
    expect(mergeEnvFile).toHaveBeenCalledWith(
      "/mock/workspace/.env",
      expect.objectContaining({
        SPRING_AI_OLLAMA_BASE_URL: "http://localhost:11434",
        OLLAMA_BASE_URL: "http://localhost:11434",
        DEFAULT_PROVIDER: "ollama",
      })
    );

    // Verify docker-compose.override.yml content. Bundled infra needs no service
    // override — the base compose is already complete (AGENTS.md §1 infra-only),
    // so the override declares an empty service map (scale: 0 is external-only).
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("docker-compose.override.yml"),
      expect.stringContaining("services: {}"),
      "utf-8"
    );
  });

  test("generates Production + External config correctly", async () => {
    (select as jest.Mock)
      .mockResolvedValueOnce("production") // targetEnv
      .mockResolvedValueOnce("external"); // infraMode

    (text as jest.Mock)
      .mockResolvedValueOnce("custom-db-host")
      .mockResolvedValueOnce("custom-redis-host")
      .mockResolvedValueOnce("custom-mq-host")
      .mockResolvedValueOnce("custom-ollama-host");

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await installCommand.parseAsync(["node", "install"]);

    // Verify .env reconciliation (non-destructive merge of external endpoints).
    expect(mergeEnvFile).toHaveBeenCalledWith(
      "/mock/workspace/.env",
      expect.objectContaining({
        SPRING_DATASOURCE_URL:
          "jdbc:postgresql://custom-db-host:5432/orazaka_db",
        REDIS_URL: "redis://custom-redis-host:6379",
        RABBITMQ_HOST: "custom-mq-host",
        SPRING_AI_OLLAMA_BASE_URL: "http://custom-ollama-host:11434",
      })
    );

    // Verify scale 0 for bundled services in override compose
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("docker-compose.override.yml"),
      expect.stringContaining("db-vector:\n    scale: 0"),
      "utf-8"
    );
  });
});
