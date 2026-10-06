/**
 * @file doctor.command.ts
 * @description Health diagnostics with automatic recovery suggestions.
 * Replaces the basic doctor.command.ts with advanced reporting.
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  intro,
  outro,
  logSuccess,
  logError,
  logInfo,
  note,
  confirm,
  createSpinner,
} from "../ui/prompts";
import { TableFormatter } from "../ui/table";
import { runDiagnostics, autoFixIssues, checkHttpEndpoint } from "../services/diagnostics";
import { PORTS } from "../utils/config";

export const doctorCommand = new Command("doctor")
  .description("Advanced system health check with automatic recovery suggestions")
  .option("-q, --quiet", "Only show issues, suppress passing checks")
  .option("--fix", "Attempt to auto-fix detected issues")
  .option("-v, --verbose", "Show detailed diagnostic output")
  .action(async (options: { quiet?: boolean; fix?: boolean; verbose?: boolean }) => {
    await intro(chalk.cyan.bold("🥷 Orazaka System Diagnostics v2"));

    const spinner = await createSpinner();

    // Run diagnostics
    spinner.start("Scanning system and workspace...");
    const report = await runDiagnostics();
    spinner.stop(`Scan complete: ${report.criticalCount} error(s), ${report.warningCount} warning(s)`);

    // Display system info
    if (!options.quiet) {
      await note(
        [
          `${chalk.yellow("OS")}             ${report.systemInfo.platform} (${report.systemInfo.arch})`,
          `${chalk.yellow("Hostname")}       ${report.systemInfo.hostname}`,
          `${chalk.yellow("CPU")}            ${report.systemInfo.cpuModel}`,
          `${chalk.yellow("Memory")}         ${report.systemInfo.totalMemoryGb} GB`,
          `${chalk.yellow("Node.js")}        ${report.systemInfo.nodeVersion}`,
        ].join("\n"),
        "System Information"
      );
    }

    // Display issues in table format
    if (report.issues.length > 0) {
      const issueRows: string[][] = [];

      for (const issue of report.issues) {
        const statusIcon =
          issue.severity === "error"
            ? chalk.red("✖")
            : issue.severity === "warning"
              ? chalk.yellow("⚠")
              : chalk.blue("ℹ");

        issueRows.push([
          statusIcon,
          chalk.gray(issue.code),
          issue.title,
          chalk.yellow(issue.severity),
        ]);
      }

      console.log("\n");
      TableFormatter.render(["Status", "Code", "Title", "Severity"], issueRows);
      console.log();

      // Show detailed suggestions
      if (options.verbose) {
        for (const issue of report.issues) {
          await logInfo(`\n${chalk.bold(issue.title)} (${issue.code})`);
          console.log(`  ${issue.description}\n`);
          console.log("  Suggestions:");
          for (const suggestion of issue.suggestions) {
            console.log(`    • ${suggestion}`);
          }
        }
      } else {
        await note(
          report.issues
            .map(
              (issue) =>
                `${chalk.bold(issue.code)}: ${issue.title}\n${issue.description}\n\nRun with ${chalk.cyan("--verbose")} to see suggestions.`
            )
            .join("\n\n"),
          "Detected Issues"
        );
      }

      // Attempt auto-fix if requested
      if (options.fix && report.issues.some((i) => i.autoFixable)) {
        const shouldFix = await confirm({
          message: "Attempt to auto-fix detected issues?",
          initialValue: false,
        });

        if (shouldFix) {
          spinner.start("Applying fixes...");
          const fixed = await autoFixIssues(report.issues);
          spinner.stop(`Fixed ${fixed.length} issue(s)`);

          if (fixed.length > 0) {
            for (const fixCode of fixed) {
              await logSuccess(`Fixed: ${fixCode}`);
            }
          }
        }
      }

      // Exit with error if critical issues
      if (report.criticalCount > 0) {
        await logError(
          `${report.criticalCount} critical issue(s) detected.\n` +
          `Run with ${chalk.cyan("--verbose")} to see detailed suggestions.`
        );
        process.exit(1);
      }
    } else {
      await logSuccess("✨ All systems healthy!");
    }

    // Runtime checks (ports, services)
    await logInfo("Checking runtime services...");
    const portChecks = [
      { port: PORTS.postgres, name: "PostgreSQL", service: "database" },
      { port: PORTS.redis, name: "Redis", service: "cache" },
      { port: PORTS.rabbitmq, name: "RabbitMQ", service: "queue" },
      { port: PORTS.ollama, name: "Ollama", service: "ai-engine" },
      { port: PORTS.localai, name: "LocalAI (Images)", service: "image-worker" },
      { port: PORTS.mediaWorker, name: "Media Worker", service: "media-worker" },
      { port: PORTS.router, name: "Router API", service: "backend" },
      { port: PORTS.web, name: "UI Frontend", service: "frontend" },
    ];

    const serviceRows: string[][] = [];

    for (const check of portChecks) {
      const available = !(await checkHttpEndpoint(`http://localhost:${check.port}`, 500));
      const status = available ? chalk.gray("Not Running") : chalk.green("✔ Running");
      serviceRows.push([check.name, String(check.port), status]);
    }

    console.log();
    TableFormatter.render(["Service", "Port", "Status"], serviceRows);
    console.log();

    await outro(chalk.cyan("✨ Diagnostics complete."));
  });
