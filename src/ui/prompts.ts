/**
 * @file prompts.ts
 * @description Dynamic loader wrapper for ESM-only @clack/prompts in a CommonJS project.
 * Uses native TypeScript `typeof import()` with resolution-mode for zero-cast type safety.
 * Exposes a rich set of interactive primitives for premium CLI UX.
 */

type ClackPrompts = typeof import(
  "@clack/prompts",
  { with: { "resolution-mode": "import" } }
);

let cache: ClackPrompts | null = null;
let loader: () => Promise<ClackPrompts> = () => import("@clack/prompts");

async function getPrompts(): Promise<ClackPrompts> {
  cache ??= await loader();
  return cache;
}

/**
 * Test-only: inject a mock loader and reset the module cache.
 * Production code must never call this.
 */
export function _setTestLoader(mockLoader: () => Promise<ClackPrompts>): void {
  cache = null;
  loader = mockLoader;
}

/**
 * Test-only: reset to the real @clack/prompts loader.
 */
export function _resetLoader(): void {
  cache = null;
  loader = () => import("@clack/prompts");
}

// ─── Core Primitives ───────────────────────────────────────────

export async function intro(message: string): Promise<void> {
  const p = await getPrompts();
  p.intro(message);
}

export async function outro(message: string): Promise<void> {
  const p = await getPrompts();
  p.outro(message);
}

export async function text(options: {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string | symbol> {
  const p = await getPrompts();
  return p.text(options);
}

export async function password(options: {
  message: string;
  validate?: (value: string) => string | undefined;
}): Promise<string | symbol> {
  const p = await getPrompts();
  return p.password(options);
}

// ─── Select & Multiselect ──────────────────────────────────────

export async function select<Value>(options: {
  message: string;
  options: Array<{ value: Value; label?: string; hint?: string }>;
  initialValue?: Value;
}): Promise<Value | symbol> {
  const p = await getPrompts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return p.select(options as any);
}

export async function multiselect<Value>(options: {
  message: string;
  options: Array<{ value: Value; label?: string; hint?: string }>;
  required?: boolean;
  initialValues?: Value[];
}): Promise<Value[] | symbol> {
  const p = await getPrompts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return p.multiselect(options as any);
}

// ─── Confirm ───────────────────────────────────────────────────

export async function confirm(options: {
  message: string;
  initialValue?: boolean;
  active?: string;
  inactive?: string;
}): Promise<boolean | symbol> {
  const p = await getPrompts();
  return p.confirm(options);
}

// ─── Note & Log ────────────────────────────────────────────────

export async function note(message: string, title?: string): Promise<void> {
  const p = await getPrompts();
  p.note(message, title);
}

export async function log(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.message(message);
}

export async function logStep(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.step(message);
}

export async function logSuccess(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.success(message);
}

export async function logWarning(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.warn(message);
}

export async function logError(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.error(message);
}

export async function logInfo(message: string): Promise<void> {
  const p = await getPrompts();
  p.log.info(message);
}

// ─── Spinner ───────────────────────────────────────────────────

export interface ClackSpinner {
  start(msg?: string): void;
  stop(msg?: string, code?: number): void;
  message(msg?: string): void;
}

export async function createSpinner(): Promise<ClackSpinner> {
  const p = await getPrompts();
  return p.spinner();
}

// ─── Cancel Detection ──────────────────────────────────────────

export function isCancel(value: unknown): value is symbol {
  return typeof value === "symbol";
}

/**
 * Handles cancellation by printing a message and exiting.
 * Use this after any prompt to guard against user cancellation.
 */
export function handleCancel(value: unknown, message?: string): void {
  if (isCancel(value)) {
    console.log("");
    console.log(message ?? "Operation cancelled.");
    // eslint-disable-next-line no-restricted-syntax
    process.exit(0);
  }
}
