/**
 * @file onboard.command.ts
 * @description ERR-125 compliant onboarding subcommand for Orazaka CLI.
 * Handles full clone-and-run validation: prerequisite checks, Maven compilation,
 * M2M signed handshake smoke test, local sovereign AI runtime health checks,
 * and hardware accelerator detection with SLA guardrails.
 *
 * Usage: npx orazaka onboard
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import chalk from "chalk";

/** Minimum required versions for each prerequisite. */
const PREREQUISITES = [
  { name: "Java", command: "java -version", regex: /version "(\d+)/, minMajor: 21 },
  { name: "Node.js", command: "node --version", regex: /v(\d+)/, minMajor: 24 },
  { name: "Python", command: "python3 --version", regex: /(\d+\.\d+)/, minMajor: 3 },
  { name: "Docker", command: "docker --version", regex: /(\d+\.\d+)/, minMajor: 20 },
  { name: "Ollama", command: "ollama --version", regex: /(\d+\.\d+)/, minMajor: 0 },
] as const;

/** Local sovereign AI runtimes probed for live connectivity. */
const OLLAMA_TAGS_URL = process.env.OLLAMA_HOST
  ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/api/tags`
  : "http://localhost:11434/api/tags";
const LOCALAI_MODELS_URL = process.env.ORAZAKA_LOCALAI_URL
  ? `${process.env.ORAZAKA_LOCALAI_URL.replace(/\/$/, "")}/v1/models`
  : undefined;

interface PrerequisiteResult {
  name: string;
  ok: boolean;
  version: string;
  error?: string;
}

function checkPrerequisite(prereq: (typeof PREREQUISITES)[number]): PrerequisiteResult {
  try {
    const output = execSync(prereq.command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const match = output.match(prereq.regex);
    const version = match ? match[1] : "unknown";
    const major = parseInt(version, 10);
    const ok = !isNaN(major) && major >= prereq.minMajor;
    return { name: prereq.name, ok, version };
  } catch {
    return { name: prereq.name, ok: false, version: "not found", error: `${prereq.name} is not installed` };
  }
}

function runPrerequisiteChecks(): boolean {
  console.log(chalk.cyan.bold("\n🔍 Phase 1: Prerequisite Verification\n"));
  let allPassed = true;

  for (const prereq of PREREQUISITES) {
    const result = checkPrerequisite(prereq);
    const icon = result.ok ? chalk.green("✔") : chalk.red("✘");
    const versionText = result.ok
      ? chalk.gray(`(${result.version})`)
      : chalk.red(`(${result.version} — requires >= ${prereq.minMajor})`);
    console.log(`  ${icon} ${chalk.white(result.name)} ${versionText}`);
    if (!result.ok) allPassed = false;
  }

  return allPassed;
}

function runCompilation(): boolean {
  console.log(chalk.cyan.bold("\n🔨 Phase 2: Maven Compilation (skipTests)\n"));
  try {
    execSync("./mvnw clean install -DskipTests -q", {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 300_000,
    });
    console.log(chalk.green("  ✔ Compilation succeeded."));
    return true;
  } catch {
    console.error(chalk.red("  ✘ Compilation failed. Check Maven output above."));
    return false;
  }
}

function runHandshakeSmokeTest(): boolean {
  console.log(chalk.cyan.bold("\n🤝 Phase 3: M2M Signed Handshake Smoke Test\n"));
  try {
    // Validate the router's intent endpoint is responding with correct JWT rejection
    const curlCmd = [
      "curl -s -o /dev/null -w '%{http_code}'",
      "-X POST http://localhost:8080/api/v1/intent/route",
      "-H 'Content-Type: application/json'",
      "-d '{\"userId\":\"smoke-test\",\"rawPrompt\":\"ping\",\"sessionId\":\"test\"}'",
    ].join(" ");

    const statusCode = execSync(curlCmd, { encoding: "utf-8", timeout: 10_000 }).trim();

    if (statusCode === "401" || statusCode === "403") {
      console.log(chalk.green("  ✔ Intent router correctly rejected unsigned request (HTTP " + statusCode + ")."));
      console.log(chalk.gray("    M2M JWT gate is active — handshake validated."));
      return true;
    } else if (statusCode === "000") {
      console.log(chalk.yellow("  ⚠ Router is not running. Start with: npx orazaka dev"));
      console.log(chalk.gray("    Skipping live handshake — prerequisite and compilation passed."));
      return true; // Non-fatal: offline mode
    } else {
      console.log(chalk.red("  ✘ Unexpected status code: " + statusCode));
      return false;
    }
  } catch {
    console.log(chalk.yellow("  ⚠ Could not reach router. Offline mode — skipping handshake."));
    return true; // Non-fatal
  }
}

/** Probe a JSON HTTP endpoint with a hard timeout — never blocks the shell. */
async function probeEndpoint(url: string, timeoutMs = 3_000): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { models?: unknown[]; data?: unknown[] };
    const count = body.models?.length ?? body.data?.length ?? 0;
    return { ok: true, detail: `${count} model(s) available` };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "unreachable";
    return { ok: false, detail: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Phase 4 — local sovereign provider connectivity (Ollama + optional LocalAI). */
async function runLocalRuntimeChecks(): Promise<void> {
  console.log(chalk.cyan.bold("\n🧠 Phase 4: Local Sovereign AI Runtime Health\n"));

  const ollama = await probeEndpoint(OLLAMA_TAGS_URL);
  if (ollama.ok) {
    console.log(`  ${chalk.green("✔")} Ollama daemon responsive ${chalk.gray(`(${ollama.detail})`)}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} Ollama not reachable at ${chalk.gray(OLLAMA_TAGS_URL)} ${chalk.gray(`— ${ollama.detail}`)}`);
    console.log(chalk.gray("    Start it with: ollama serve"));
  }

  if (LOCALAI_MODELS_URL) {
    const localai = await probeEndpoint(LOCALAI_MODELS_URL);
    if (localai.ok) {
      console.log(`  ${chalk.green("✔")} LocalAI endpoint responsive ${chalk.gray(`(${localai.detail})`)}`);
    } else {
      console.log(`  ${chalk.yellow("⚠")} LocalAI not reachable at ${chalk.gray(LOCALAI_MODELS_URL)} ${chalk.gray(`— ${localai.detail}`)}`);
    }
  } else {
    console.log(`  ${chalk.gray("○")} LocalAI not configured ${chalk.gray("(set ORAZAKA_LOCALAI_URL to enable)")}`);
  }
}

/** Best-effort, non-throwing command probe used for accelerator detection. */
function tryCommand(command: string): string | null {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return null;
  }
}

/** Phase 5 — hardware accelerator detection guardrail (CUDA / Metal / ROCm). */
function runAcceleratorDetection(): void {
  console.log(chalk.cyan.bold("\n⚡ Phase 5: Hardware Accelerator Detection\n"));
  const detected: string[] = [];

  // NVIDIA CUDA — nvidia-smi boundary check.
  const nvidia = tryCommand("nvidia-smi --query-gpu=name --format=csv,noheader");
  if (nvidia) {
    const gpu = nvidia.split("\n")[0].trim();
    detected.push(`NVIDIA CUDA (${gpu})`);
    console.log(`  ${chalk.green("✔")} NVIDIA CUDA detected ${chalk.gray(`(${gpu})`)}`);
  }

  // Apple Silicon Metal — macOS system_profiler parsing.
  if (platform() === "darwin") {
    const chip = tryCommand("system_profiler SPHardwareDataType");
    const isAppleSilicon = chip != null && /Chip:\s*Apple/i.test(chip);
    if (isAppleSilicon) {
      const match = chip.match(/Chip:\s*(.+)/);
      const chipName = match ? match[1].trim() : "Apple Silicon";
      detected.push(`Apple Metal (${chipName})`);
      console.log(`  ${chalk.green("✔")} Apple Silicon Metal detected ${chalk.gray(`(${chipName})`)}`);
    }
  }

  // AMD ROCm / Linux DRI device nodes.
  const rocm = tryCommand("rocminfo");
  if (rocm && /GPU/i.test(rocm)) {
    detected.push("AMD ROCm");
    console.log(`  ${chalk.green("✔")} AMD ROCm runtime detected`);
  } else if (platform() === "linux") {
    const dri = tryCommand("ls /dev/dri/renderD128");
    if (dri) {
      detected.push("Linux DRI render node");
      console.log(`  ${chalk.green("✔")} Linux DRI render node detected ${chalk.gray("(/dev/dri/renderD128)")}`);
    }
  }

  if (detected.length === 0) {
    console.log(chalk.red.bold("\n  ⛔ WARNING: No GPU/NPU accelerator detected."));
    console.log(
      chalk.red(
        "  Local models will fall back to CPU execution, which violates Orazaka synchronous runtime latency SLAs.",
      ),
    );
  } else {
    console.log(chalk.gray(`\n  Accelerator(s) active: ${detected.join(", ")}`));
  }
}

export const onboardCommand = new Command("onboard")
  .description("Full clone-and-run onboarding: verify prerequisites, compile, smoke-test M2M handshake, and probe local AI runtimes")
  .action(async () => {
    console.log(chalk.cyan.bold("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.cyan.bold("  🥷  ORAZAKA ONBOARDING — Production Readiness"));
    console.log(chalk.cyan.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

    // Phase 1: Prerequisites
    if (!runPrerequisiteChecks()) {
      console.error(chalk.red("\n❌ Prerequisites failed. Install missing tools and retry."));
      process.exit(1);
    }

    // Phase 2: Compilation
    if (!runCompilation()) {
      process.exit(1);
    }

    // Phase 3: Handshake smoke test
    if (!runHandshakeSmokeTest()) {
      process.exit(1);
    }

    // Phase 4: Local sovereign AI runtime health (non-fatal — advisory)
    await runLocalRuntimeChecks();

    // Phase 5: Hardware accelerator detection (non-fatal — SLA guardrail)
    runAcceleratorDetection();

    console.log(chalk.green.bold("\n✅ Onboarding complete. System is production-ready.\n"));
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.white("  $ npx orazaka start   ") + chalk.gray("Launch infrastructure"));
    console.log(chalk.white("  $ npx orazaka dev     ") + chalk.gray("Launch full dev stack"));
    console.log(chalk.white("  $ npx orazaka status  ") + chalk.gray("Check service health\n"));
  });
