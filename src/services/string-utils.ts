/**
 * @file string-utils.ts
 * @description String transformation utilities for template generation.
 */

/**
 * Converts a string to PascalCase (UpperCamelCase).
 * Example: "hello-world" -> "HelloWorld"
 */
export function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Converts a string to camelCase.
 * Example: "hello-world" -> "helloWorld"
 */
export function camelCase(str: string): string {
  const pascal = pascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Converts a string to kebab-case (slug).
 * Example: "HelloWorld" -> "hello-world"
 */
export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Converts a string to snake_case.
 * Example: "HelloWorld" -> "hello_world"
 */
export function snakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Converts a string to CONSTANT_CASE.
 * Example: "hello-world" -> "HELLO_WORLD"
 */
export function constantCase(str: string): string {
  return snakeCase(str).toUpperCase();
}

/**
 * Validates if a string is a valid identifier (variable/class name).
 */
export function isValidIdentifier(str: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str);
}

/**
 * Validates if a string is a valid kebab-case identifier.
 */
export function isValidKebabCase(str: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(str);
}
