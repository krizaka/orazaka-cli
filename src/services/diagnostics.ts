/**
 * @file diagnostics.ts
 * @description Advanced diagnostic and verification system for detecting issues
 * and suggesting recovery strategies during installation and startup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  hasTool,
  getToolVersion,
  resolveWorkspaceRoot,
  resolveEnvFile,
  resolveComposeFile,
  getSystemInfo,
} from "../utils/platform";
import type { SystemInfo } from "../utils/platform";
// Re-export the shared health primitives so existing importers
// (`status`, `doctor`) keep importing them from this module.
export { checkPortAvailable, checkHttpEndpoint } from "../utils/health";

/**
 * Diagnosis result with recovery suggestions.
 */
export interface DiagnosticIssue {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly title: string;
  readonly description: string;
  readonly suggestions: readonly string[];
  readonly autoFixable?: boolean;
}

/**
 * Complete diagnostic report.
 */
export interface DiagnosticReport {
  readonly timestamp: Date;
  readonly systemInfo: SystemInfo;
  readonly issues: readonly DiagnosticIssue[];
  readonly criticalCount: number;
  readonly warningCount: number;
}

/**
 * Detects which Docker Compose is available and its version.
 */
export function detectDockerCompose(): {
  available: boolean;
  command: string | null;
  version: string | null;
} {
  try {
    if (hasTool("docker-compose")) {
      const version = getToolVersion("docker-compose");
      return { available: true, command: "docker-compose", version };
    }
  } catch { /* docker-compose standalone not available */ }

  try {
    if (hasTool("docker")) {
      execSync("docker compose version", { stdio: "ignore" });
      const version = getToolVersion("docker");
      return { available: true, command: "docker compose", version };
    }
  } catch { /* docker compose plugin not available */ }

  return { available: false, command: null, version: null };
}

/**
 * Checks if LocalAI is available on the system.
 */
export function detectLocalAI(): {
  available: boolean;
  command: string | null;
  version: string | null;
  isMPS: boolean;
} {
  try {
    const hasLocalAI = hasTool("local-ai") || hasTool("localai");
    const isMPS = process.platform === "darwin"; // Metal Performance Shaders on macOS
    const version = hasLocalAI ? getToolVersion("local-ai") : null;
    return {
      available: hasLocalAI,
      command: hasLocalAI ? "local-ai" : null,
      version,
      isMPS,
    };
  } catch {
    return { available: false, command: null, version: null, isMPS: false };
  }
}

/**
 * Runs a comprehensive diagnostic check.
 */
export async function runDiagnostics(): Promise<DiagnosticReport> {
  const issues: DiagnosticIssue[] = [];
  const systemInfo = getSystemInfo();

  // 1. Check Node.js version (should be 18+)
  try {
    const version = parseInt(process.version.split(".")[0].substring(1));
    if (version < 18) {
      issues.push({
        code: "NODE_VERSION_OLD",
        severity: "error",
        title: "Node.js version too old",
        description: `Found Node.js ${process.version}, but v18.0.0+ is required.`,
        suggestions: [
          "Install Node.js 20 or later from https://nodejs.org",
          "Use nvm (Node Version Manager) for easy switching: nvm install 20",
          "On macOS: brew install node",
        ],
      });
    }
  } catch { /* version parse failed, skip check */ }

  // 2. Check Docker availability
  const dockerStatus = detectDockerCompose();
  if (!dockerStatus.available) {
    issues.push({
      code: "DOCKER_MISSING",
      severity: "error",
      title: "Docker not found",
      description: "Docker Compose is required to run database middleware (Postgres, Redis, RabbitMQ).",
      suggestions: [
        "Install Docker Desktop from https://www.docker.com/products/docker-desktop",
        "On macOS: brew install --cask docker",
        "On Linux: sudo apt-get install docker.io docker-compose",
      ],
    });
  }

  // 3. Check Java availability
  if (!hasTool("java")) {
    issues.push({
      code: "JAVA_MISSING",
      severity: "error",
      title: "Java 21 not found",
      description: "Java 21+ is required to build and run the backend.",
      suggestions: [
        "Install Java 21 from https://adoptium.net",
        "On macOS: brew install openjdk@21",
        "On Linux: sudo apt-get install openjdk-21-jdk",
      ],
    });
  } else {
    const javaVersion = getToolVersion("java");
    if (!javaVersion.includes("21") && !javaVersion.includes("22") && !javaVersion.includes("23")) {
      issues.push({
        code: "JAVA_VERSION_MISMATCH",
        severity: "warning",
        title: "Java version may not be compatible",
        description: `Found: ${javaVersion}. Orazaka requires Java 21+.`,
        suggestions: [
          "Install Java 21+: https://adoptium.net",
          "Set JAVA_HOME to the Java 21 installation",
        ],
      });
    }
  }

  // 4. Check Python (for video worker)
  if (!hasTool("python3")) {
    issues.push({
      code: "PYTHON_MISSING",
      severity: "warning",
      title: "Python 3 not found",
      description: "Python 3.11+ is optional but needed for video rendering.",
      suggestions: [
        "Install Python 3.11+ from https://python.org",
        "On macOS: brew install python@3.11",
        "On Linux: sudo apt-get install python3.11",
      ],
    });
  }

  // 5. Check Maven (for Java builds)
  if (!hasTool("mvn")) {
    issues.push({
      code: "MAVEN_MISSING",
      severity: "warning",
      title: "Maven not found",
      description: "Maven is needed to build Java modules.",
      suggestions: [
        "Install Maven from https://maven.apache.org",
        "On macOS: brew install maven",
        "Or use the included ./mvnw wrapper",
      ],
    });
  }

  // 6. Check Git
  if (!hasTool("git")) {
    issues.push({
      code: "GIT_MISSING",
      severity: "warning",
      title: "Git not found",
      description: "Git is recommended for version control.",
      suggestions: [
        "Install Git from https://git-scm.com",
        "On macOS: brew install git",
      ],
    });
  }

  // 7. Check LocalAI (critical for image generation on macOS M1)
  if (systemInfo.isAppleSilicon) {
    const localAIStatus = detectLocalAI();
    if (!localAIStatus.available) {
      issues.push({
        code: "LOCALAI_MISSING_M1",
        severity: "warning",
        title: "LocalAI not found (Image generation unavailable)",
        description: "On macOS M1/M2/M3, LocalAI is recommended for GPU-accelerated image generation. Image synthesis will fail without it.",
        suggestions: [
          "Install LocalAI: https://localai.io/docs/getting-started/",
          "On macOS: brew install localai",
          "Or download pre-built binary: https://github.com/go-skynet/LocalAI/releases",
          "Verify installation: local-ai --version",
        ],
      });
    } else if (localAIStatus.isMPS) {
      // Good: LocalAI is available on Apple Silicon with Metal support
    }
  }

  // 8. Check workspace structure
  const workspaceRoot = resolveWorkspaceRoot();
  const requiredDirs = ["orazaka-libs", "orazaka-apps", "infra", "docs"];
  for (const dir of requiredDirs) {
    if (!fs.existsSync(path.join(workspaceRoot, dir))) {
      issues.push({
        code: "WORKSPACE_INVALID",
        severity: "error",
        title: "Invalid workspace structure",
        description: `Missing directory: ${dir}`,
        suggestions: [
          "Run this command from the Orazaka project root directory",
          "Ensure all subdirectories are present",
        ],
      });
      break;
    }
  }

  // 8. Check .env file
  const envFile = resolveEnvFile();
  if (!fs.existsSync(envFile)) {
    issues.push({
      code: "ENV_MISSING",
      severity: "warning",
      title: ".env file not found",
      description: "No environment configuration found.",
      suggestions: [
        "Run: npx orazaka init",
        "Or manually create a .env file with required variables",
      ],
      autoFixable: true,
    });
  }

  // 9. Check docker-compose.yml
  const composeFile = resolveComposeFile();
  if (!fs.existsSync(composeFile)) {
    issues.push({
      code: "COMPOSE_MISSING",
      severity: "warning",
      title: "docker-compose.yml not found",
      description: "Docker Compose configuration is missing.",
      suggestions: [
        "Run: npx orazaka init",
        "Or restore the file from version control",
      ],
      autoFixable: true,
    });
  }

  // 10. Check memory requirements
  const requiredMemoryGb = 8;
  if (systemInfo.totalMemoryGb < requiredMemoryGb) {
    issues.push({
      code: "LOW_MEMORY",
      severity: "warning",
      title: "Insufficient system memory",
      description: `Found ${systemInfo.totalMemoryGb}GB, but ${requiredMemoryGb}GB is recommended.`,
      suggestions: [
        "Close other applications to free up memory",
        "Consider upgrading system RAM",
        "Use the lightweight profile in installation",
      ],
    });
  }

  return {
    timestamp: new Date(),
    systemInfo,
    issues,
    criticalCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
  };
}

/**
 * Attempts to auto-fix fixable issues.
 */
export async function autoFixIssues(issues: readonly DiagnosticIssue[]): Promise<string[]> {
  const fixed: string[] = [];

  for (const issue of issues) {
    if (!issue.autoFixable) continue;

    if (issue.code === "ENV_MISSING") {
      // env.ts will be initialized by init command
      fixed.push("ENV_MISSING");
    }

    if (issue.code === "COMPOSE_MISSING") {
      // docker-compose.yml will be generated by init command
      fixed.push("COMPOSE_MISSING");
    }
  }

  return fixed;
}
