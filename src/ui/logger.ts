/**
 * @file logger.ts
 * @description Unified status logger presenting styled CLI warnings, errors, and success markers.
 */

import chalk from "chalk";

export const Logger = {
  success: (message: string): void => {
    console.log(chalk.green(`✓ ${message}`));
  },

  error: (message: string): void => {
    console.error(chalk.red(`❌ Error: ${message}`));
  },

  info: (message: string): void => {
    console.log(chalk.cyan(`ℹ ${message}`));
  },

  warn: (message: string): void => {
    console.warn(chalk.yellow(`⚠ Warning: ${message}`));
  },

  hint: (message: string): void => {
    console.log(chalk.gray(`  Hint: ${message}`));
  },
} as const;
