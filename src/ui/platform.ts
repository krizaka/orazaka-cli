/**
 * @file platform.ts (barrel re-export)
 * @description Re-exports all platform utilities from src/utils/platform.ts.
 * Keeps backward compatibility for commands importing from '../ui/platform'.
 *
 * The actual implementation lives in src/utils/platform.ts to satisfy
 * the dependency-cruiser rule: services must not import from the UI layer.
 */
export {
  hasTool,
  getToolVersion,
  detectOrazakaWorkspace,
  resolveWorkspaceRootSmart,
  resolveWorkspaceRoot,
  resolveVarDir,
  resolveLogDir,
  resolvePidFile,
  resolveComposeFile,
  resolveEnvFile,
  resolveModelsDir,
  getPlatform,
  isAppleSilicon,
  getSystemInfo,
  ensureDir,
  parseEnvFile,
  mergeEnvFile,
  writeEnvFile,
  resolveDockerComposeCmd,
} from "../utils/platform";

export type { WorkspaceDetection, SystemInfo } from "../utils/platform";
