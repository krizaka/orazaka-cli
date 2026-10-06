/**
 * @file box.ts
 * @description UI component for printing styled box structures, headers, and card layouts using Chalk.
 */

import chalk from "chalk";

export interface BoxOptions {
  readonly width?: number;
  readonly borderColor?: "cyan" | "green" | "yellow" | "red" | "magenta" | "gray";
  readonly titleColor?: "cyan" | "green" | "yellow" | "red" | "magenta" | "white";
}

export const Box = {
  /**
   * Renders a box with a title and a list of key-value pairs or content lines.
   */
  render: (
    title: string,
    content: Array<string | { key: string; value: string }>,
    options: BoxOptions = {},
  ): void => {
    const width = options.width || 60;
    const borderChalk = chalk[options.borderColor || "cyan"];
    const titleChalk = chalk[options.titleColor || "white"].bold;

    const top = borderChalk(`┌${"─".repeat(width - 2)}┐`);
    const middle = borderChalk(`├${"─".repeat(width - 2)}┤`);
    const bottom = borderChalk(`└${"─".repeat(width - 2)}┘`);

    console.log(top);

    // Render Title
    const titleText = `  ${title}`;
    const titleLine = titleChalk(titleText.padEnd(width - 4));
    console.log(`${borderChalk("│")}${titleLine}${borderChalk("│")}`);

    console.log(middle);

    // Render Content
    for (const item of content) {
      if (typeof item === "string") {
        const text = `  ${item}`;
        const line = chalk.white(text.padEnd(width - 4));
        console.log(`${borderChalk("│")}${line}${borderChalk("│")}`);
      } else {
        const keyText = `  ${item.key}:`;
        const valText = String(item.value);
        const padding = width - 4 - keyText.length;
        const line = `${chalk.yellow(keyText)} ${chalk.white(valText.padEnd(padding - 1))}`;
        console.log(`${borderChalk("│")}${line}${borderChalk("│")}`);
      }
    }

    console.log(bottom);
  },
} as const;
