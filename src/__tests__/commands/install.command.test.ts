import { installCommand } from "../../commands/install.command";
import * as fs from "node:fs";
import { select, text, createSpinner } from "../../ui/prompts";
import { locateWorkspace, mergeEnvFile } from "../../ui/platform";
import { bootstrapWorkspace } from "../../services/workspace-bootstrap";

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

jest.mock("../../services/workspace-bootstrap", () => ({
  bootstrapWorkspace: jest.fn(() => ({ ok: true, root: "/mock/fresh/orazaka" })),
}));

jest.mock("../../ui/platform", () => ({
  locateWorkspace: jest.fn(() => "/mock/workspace"),
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

  const tty = process.stdin.isTTY;

  afterAll(() => {
    process.stdin.isTTY = tty;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.stdin.isTTY = true;
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

  test("generates a strong password for every database role, stored owner-only (fresh install)", async () => {
    (select as jest.Mock).mockResolvedValueOnce("local_dev").mockResolvedValueOnce("bundled");
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue("BILLING_DB_PASSWORD=CHANGE_ME\nSTUDIO_DB_PASSWORD=CHANGE_ME\n");

    await installCommand.parseAsync(["node", "install"]);

    const written = (fs.writeFileSync as jest.Mock).mock.calls
      .filter(([file]) => file === "/mock/workspace/.env")
      .map(([, content]) => String(content))
      .join("\n");
    for (const ctx of ["IDENTITY", "KNOWLEDGE", "AUTOMATION", "BILLING", "STUDIO"]) {
      expect(written).toMatch(new RegExp(`${ctx}_DB_PASSWORD=[0-9a-f]{48}`));
    }
    expect(written).not.toContain("CHANGE_ME");
    expect(fs.chmodSync).toHaveBeenCalledWith("/mock/workspace/.env", 0o600);
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

  test("--yes takes the default topology without a single prompt", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue("");

    await installCommand.parseAsync(["node", "install", "--yes"]);

    expect(select).not.toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("docker-compose.override.yml"),
      expect.stringContaining("services: {}"),
      "utf-8"
    );
  });

  test("outside a workspace and without --yes, nothing is cloned when nobody can answer", async () => {
    process.stdin.isTTY = false;
    (locateWorkspace as jest.Mock).mockReturnValue(null);
    const exit = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${String(code)}`);
    }) as never);
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await expect(installCommand.parseAsync(["node", "install"])).rejects.toThrow("exit 1");

    expect(bootstrapWorkspace).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    exit.mockRestore();
    (locateWorkspace as jest.Mock).mockReturnValue("/mock/workspace");
  });

  test("outside a workspace, --yes clones the platform into --dir and configures it there", async () => {
    (locateWorkspace as jest.Mock).mockReturnValueOnce("/mock/workspace").mockReturnValueOnce(null);
    const { hasTool } = jest.requireMock("../../ui/platform") as { hasTool: jest.Mock };
    hasTool.mockReturnValue(true);
    const chdir = jest.spyOn(process, "chdir").mockImplementation(() => undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue("");

    await installCommand.parseAsync(["node", "install", "--yes", "--dir", "/mock/fresh/orazaka", "--depth", "1"]);

    expect(bootstrapWorkspace).toHaveBeenCalledWith("/mock/fresh/orazaka", { depth: 1 });
    expect(chdir).toHaveBeenCalledWith("/mock/fresh/orazaka");
    chdir.mockRestore();
    hasTool.mockReturnValue(false);
  });
});
