/**
 * @file table.ts
 * @description Tabular data rendering component using cli-table3 and Chalk.
 */

import Table from "cli-table3";
import chalk from "chalk";

export interface TableOptions {
  readonly colWidths?: number[];
  readonly headColor?: "cyan" | "green" | "yellow" | "red" | "magenta" | "white";
}

export const TableFormatter = {
  /**
   * Formats and prints a structured ASCII table to console.
   */
  render: (
    head: string[],
    rows: string[][],
    options: TableOptions = {},
  ): void => {
    const headColorChalk = chalk[options.headColor || "cyan"].bold;
    const styledHead = head.map((h) => headColorChalk(h));

    const table = new Table({
      head: styledHead,
      ...(options.colWidths ? { colWidths: options.colWidths } : {}),
      style: {
        head: [],
        border: ["gray"],
      },
    });

    for (const row of rows) {
      table.push(row);
    }

    console.log(table.toString());
  },
} as const;
