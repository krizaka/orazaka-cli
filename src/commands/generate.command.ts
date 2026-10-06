/**
 * @file generate.command.ts
 * @description Smart code generator that scans the workspace to detect placement
 * directories, generates multi-file templates, and shows a full manifest of
 * all files created or updated.
 *
 * Supported generator types:
 * - Business Feature (full-stack: service + controller + hook + BFF route)
 * - Technical Feature (properties + configuration)
 * - Interceptor (Maven submodule + SPI auto-config)
 * - External API Connector (RestClient adapter + properties)
 * - Configuration (env vars + properties)
 * - Low-level: java-service, java-controller, typescript-hook, sql-migration
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  intro,
  outro,
  select,
  text,
  logSuccess,
  logError,
  logStep,
  logWarning,
  note,
  confirm,
  handleCancel,
} from "../ui/prompts";
import {
  type TemplateContext,
  type GeneratedFile,
  type GenerationResult,
  type TemplateType,
  scanWorkspaceStructure,
  generateInterceptor,
  generateBusinessFeature,
  generateTechnicalFeature,
  generateApiConnector,
  generateConfiguration,
  generateJavaService,
  generateJavaController,
  generateTypeScriptHook,
  generateSqlMigration,
  generateDockerComposeService,
} from "../services/templates";
import { isValidKebabCase, kebabCase, pascalCase } from "../services/string-utils";
import { resolveWorkspaceRoot } from "../ui/platform";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Formats a generated file for the manifest display.
 */
function formatFileManifest(file: GeneratedFile): string {
  const icon =
    file.action === "created" ? chalk.green("✚") :
    file.action === "updated" ? chalk.yellow("✎") :
    chalk.gray("○");

  const actionLabel =
    file.action === "created" ? chalk.green("NEW") :
    file.action === "updated" ? chalk.yellow("UPD") :
    chalk.gray("SKIP");

  return `  ${icon} [${actionLabel}] ${chalk.white(file.relativePath)}\n    ${chalk.gray(file.description)}`;
}

/**
 * Writes a single-file template (legacy templates) to the correct workspace location.
 */
function writeSingleTemplate(
  type: TemplateType,
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const struct = scanWorkspaceStructure(workspaceRoot);
  const files: GeneratedFile[] = [];
  const nextSteps: string[] = [];

  switch (type) {
    case "java-service": {
      const result = generateJavaService(ctx);
      const coreSrc = path.join(
        struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
        "src", "main", "java", "com", "orazaka", "core", "application", "service",
      );
      const interfacePath = path.join(coreSrc, `${pascalCase(ctx.moduleName)}Service.java`);
      const implPath = path.join(coreSrc, `${pascalCase(ctx.moduleName)}ServiceImpl.java`);

      fs.mkdirSync(coreSrc, { recursive: true });

      if (!fs.existsSync(interfacePath)) {
        fs.writeFileSync(interfacePath, result.interface, "utf-8");
        files.push({ path: interfacePath, relativePath: path.relative(workspaceRoot, interfacePath), action: "created", description: "Service interface" });
      }
      if (!fs.existsSync(implPath)) {
        fs.writeFileSync(implPath, result.implementation, "utf-8");
        files.push({ path: implPath, relativePath: path.relative(workspaceRoot, implPath), action: "created", description: "Service implementation (package-private)" });
      }

      nextSteps.push(
        "Add business logic to the ServiceImpl",
        `Run: mvn clean install -pl orazaka-libs/orazaka-ai-engine/orazaka-core`,
      );
      break;
    }
    case "java-controller": {
      const content = generateJavaController(ctx);
      const conversationSrc = path.join(
        struct.conversationDir ?? path.join(workspaceRoot, "orazaka-apps", "services", "orazaka-conversation-service"),
        "src", "main", "java", "com", "orazaka", "conversationservice", "infrastructure", "adapter", "rest",
      );
      const controllerPath = path.join(conversationSrc, `${pascalCase(ctx.moduleName)}Controller.java`);
      fs.mkdirSync(conversationSrc, { recursive: true });
      if (!fs.existsSync(controllerPath)) {
        fs.writeFileSync(controllerPath, content, "utf-8");
        files.push({ path: controllerPath, relativePath: path.relative(workspaceRoot, controllerPath), action: "created", description: "REST controller" });
      }
      nextSteps.push(`Test: curl -X POST http://localhost:8080/${kebabCase(ctx.moduleName)}/execute`);
      break;
    }
    case "typescript-hook": {
      const content = generateTypeScriptHook(ctx);
      const hooksDir = path.join(
        struct.uiDir ?? path.join(workspaceRoot, "orazaka-apps", "ui"),
        "src", "hooks",
      );
      const hookPath = path.join(hooksDir, `use${pascalCase(ctx.moduleName)}.ts`);
      fs.mkdirSync(hooksDir, { recursive: true });
      if (!fs.existsSync(hookPath)) {
        fs.writeFileSync(hookPath, content, "utf-8");
        files.push({ path: hookPath, relativePath: path.relative(workspaceRoot, hookPath), action: "created", description: "React hook" });
      }
      nextSteps.push(`Import: import { use${pascalCase(ctx.moduleName)} } from "@/hooks/use${pascalCase(ctx.moduleName)}"`);
      break;
    }
    case "sql-migration": {
      const content = generateSqlMigration(ctx);
      const infraDir = struct.infraDir ?? path.join(workspaceRoot, "infra");
      const migrationDir = path.join(infraDir, "local-db");
      const existingFiles = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir).filter((f) => f.endsWith(".sql")) : [];
      const nextNum = String(existingFiles.length + 1).padStart(2, "0");
      const migrationPath = path.join(migrationDir, `${nextNum}-create-${kebabCase(ctx.moduleName)}.sql`);
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(migrationPath, content, "utf-8");
      files.push({ path: migrationPath, relativePath: path.relative(workspaceRoot, migrationPath), action: "created", description: "SQL migration" });
      nextSteps.push("Reload DB: npx orazaka start --reinit-db");
      break;
    }
    case "docker-compose": {
      const content = generateDockerComposeService(ctx);
      const composePath = path.join(struct.infraDir ?? path.join(workspaceRoot, "infra"), "docker-compose.yml");
      if (fs.existsSync(composePath)) {
        let existing = fs.readFileSync(composePath, "utf-8");
        existing += "\n" + content;
        fs.writeFileSync(composePath, existing, "utf-8");
        files.push({ path: composePath, relativePath: path.relative(workspaceRoot, composePath), action: "updated", description: "Added service to docker-compose.yml" });
      }
      break;
    }
    default:
      break;
  }

  return { files, nextSteps };
}

export const generateCommand = new Command("generate")
  .aliases(["gen", "scaffold"])
  .description("Generate features, interceptors, connectors, and configurations")
  .action(async () => {
    await intro(chalk.cyan.bold("🥷 Orazaka Code Generator"));

    const workspaceRoot = resolveWorkspaceRoot();
    const struct = scanWorkspaceStructure(workspaceRoot);

    // Show detected workspace structure
    const structInfo = [
      struct.interceptorsDir ? `${chalk.green("✔")} Interceptors` : `${chalk.red("✖")} Interceptors`,
      struct.coreDir ? `${chalk.green("✔")} Core` : `${chalk.red("✖")} Core`,
      struct.conversationDir ? `${chalk.green("✔")} Conversation` : `${chalk.red("✖")} Conversation`,
      struct.uiDir ? `${chalk.green("✔")} UI` : `${chalk.red("✖")} UI`,
      struct.businessDir ? `${chalk.green("✔")} Business` : `${chalk.red("✖")} Business`,
    ].join("  │  ");

    await note(structInfo, "Detected Workspace Modules");

    // Step 1: Select generator type
    const templateType = await select({
      message: "What would you like to generate?",
      options: [
        {
          value: "business-feature" as TemplateType,
          label: "📦 Business Feature",
          hint: "Full-stack: Service + Controller + React Hook + BFF Route",
        },
        {
          value: "technical-feature" as TemplateType,
          label: "⚙️  Technical Feature",
          hint: "Properties record + Configuration class + tests",
        },
        {
          value: "interceptor" as TemplateType,
          label: "🔗 Interceptor",
          hint: "Maven submodule + SPI auto-config + tests (context-matrix pipeline)",
        },
        {
          value: "api-connector" as TemplateType,
          label: "🌐 External API Connector",
          hint: "RestClient adapter + port interface + properties",
        },
        {
          value: "configuration" as TemplateType,
          label: "🔧 Configuration / Env Vars",
          hint: "Properties class + .env updates + example env template",
        },
        {
          value: "java-service" as TemplateType,
          label: "☕ Java Service (standalone)",
          hint: "Service interface + implementation in orazaka-core",
        },
        {
          value: "java-controller" as TemplateType,
          label: "🎯 REST Controller (standalone)",
          hint: "Controller in orazaka-conversation-service/adapter/rest/",
        },
        {
          value: "typescript-hook" as TemplateType,
          label: "⚛️  React Hook (standalone)",
          hint: "Custom hook with API integration",
        },
        {
          value: "sql-migration" as TemplateType,
          label: "🗃️  Database Migration",
          hint: "Auto-numbered SQL migration in infra/local-db/",
        },
        {
          value: "docker-compose" as TemplateType,
          label: "🐳 Docker Compose Service",
          hint: "Append service to docker-compose.yml",
        },
      ],
      initialValue: "business-feature" as TemplateType,
    });
    handleCancel(templateType);

    // Step 2: Get module name
    const moduleName = await text({
      message: "Enter feature/module name (kebab-case):",
      placeholder: "e.g., user-auth, payment-processor, rag-context",
      validate: (value: string) => {
        if (!value.trim()) return "Name cannot be empty";
        if (!isValidKebabCase(value)) {
          return "Must be lowercase with hyphens only (e.g., my-module)";
        }
        return undefined;
      },
    });
    handleCancel(moduleName);

    // Step 3: Get description
    const description = await text({
      message: "Brief description of this module:",
      placeholder: "e.g., User authentication and session management",
      defaultValue: `Module for ${moduleName as string}`,
    });
    handleCancel(description);

    // Step 4: Show preview
    const ctx: TemplateContext = {
      moduleName: moduleName as string,
      description: description as string,
      year: new Date().getFullYear(),
    };

    await note(
      [
        `${chalk.yellow("Type")}        ${chalk.white(templateType as string)}`,
        `${chalk.yellow("Name")}        ${chalk.white(ctx.moduleName)}`,
        `${chalk.yellow("PascalCase")}  ${chalk.cyan(pascalCase(ctx.moduleName))}`,
        `${chalk.yellow("Description")} ${chalk.white(ctx.description)}`,
      ].join("\n"),
      "Generation Preview",
    );

    // Step 5: Confirm
    const shouldGenerate = await confirm({
      message: "Generate all files?",
      initialValue: true,
    });
    handleCancel(shouldGenerate);

    if (shouldGenerate !== true) {
      await outro(chalk.yellow("Generation cancelled."));
      return;
    }

    // Step 6: Generate
    await logStep("Generating files...");

    let result: GenerationResult;

    try {
      switch (templateType as TemplateType) {
        case "interceptor":
          result = generateInterceptor(ctx, workspaceRoot);
          break;
        case "business-feature":
          result = generateBusinessFeature(ctx, workspaceRoot);
          break;
        case "technical-feature":
          result = generateTechnicalFeature(ctx, workspaceRoot);
          break;
        case "api-connector":
          result = generateApiConnector(ctx, workspaceRoot);
          break;
        case "configuration":
          result = generateConfiguration(ctx, workspaceRoot);
          break;
        default:
          result = writeSingleTemplate(templateType as TemplateType, ctx, workspaceRoot);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await logError(`Generation failed: ${msg}`);
      process.exit(1);
      return;
    }

    // Step 7: Display manifest
    if (result.files.length === 0) {
      await logWarning("No files were generated.");
      await outro(chalk.yellow("Nothing to do."));
      return;
    }

    const created = result.files.filter((f) => f.action === "created");
    const updated = result.files.filter((f) => f.action === "updated");
    const skipped = result.files.filter((f) => f.action === "skipped");

    const manifestLines: string[] = [];

    if (created.length > 0) {
      manifestLines.push(chalk.green.bold(`📄 Created (${String(created.length)}):`));
      for (const f of created) {
        manifestLines.push(formatFileManifest(f));
      }
      manifestLines.push("");
    }

    if (updated.length > 0) {
      manifestLines.push(chalk.yellow.bold(`✎  Updated (${String(updated.length)}):`));
      for (const f of updated) {
        manifestLines.push(formatFileManifest(f));
      }
      manifestLines.push("");
    }

    if (skipped.length > 0) {
      manifestLines.push(chalk.gray(`○  Skipped (${String(skipped.length)}):`));
      for (const f of skipped) {
        manifestLines.push(formatFileManifest(f));
      }
      manifestLines.push("");
    }

    manifestLines.push(
      chalk.gray("─".repeat(50)),
      `  Total: ${chalk.green(String(created.length))} new, ${chalk.yellow(String(updated.length))} updated, ${chalk.gray(String(skipped.length))} skipped`,
    );

    await note(manifestLines.join("\n"), "📋 File Manifest");

    // Step 8: Show next steps
    if (result.nextSteps.length > 0) {
      const stepsLines = result.nextSteps.map((step, i) =>
        `  ${chalk.cyan(String(i + 1) + ".")} ${step}`
      );
      await note(stepsLines.join("\n"), "🚀 Next Steps");
    }

    await logSuccess(
      `✨ Generated ${String(result.files.length)} file(s) for ${chalk.cyan(pascalCase(ctx.moduleName))}`,
    );
    await outro(chalk.cyan("Happy coding! 🥷"));
  });
