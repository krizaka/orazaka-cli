/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error", // 🔥 CRITICAL: Protects terminal loop stability
      comment: "Circular dependencies are strictly banned across Orazaka CLI. They break execution flow and lead to memory leaks.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphan-modules",
      severity: "error", // 🔥 ACTIVE PURGE: Automatically flags unlinked commands or services
      comment: "Dead code, unused files, or unlinked modules are forbidden in the production source tree.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+", // Hidden dot files
          "\\.d\\.ts$",    // Type declaration files
          "(^|/)tsconfig\\.json$",
          "src/index\\.ts$", // CLI Entrypoint
          "__tests__/",     // Test folder
          "\\.test\\.ts$",  // Unit test files
          "\\.spec\\.ts$"   // Integration spec files
        ],
      },
      to: {},
    },
    {
      name: "no-ui-import-commands",
      severity: "error", // 🔥 TOTAL ENFORCEMENT: Guarantees raw presentation abstraction
      comment: "Pure UI layout templates and terminal elements must remain domain-agnostic and must not import command routers directly.",
      from: {
        path: "^src/ui/",
      },
      to: {
        path: "^src/commands/",
      },
    },
    {
      name: "no-services-import-commands",
      severity: "error",
      comment: "Services must remain abstract data processors and must not import command modules directly.",
      from: {
        path: "^src/services/",
      },
      to: {
        path: "^src/commands/",
      },
    },
    /* 🛡️ ADVANCED CLI ARCHITECTURAL SECURITY CONSTRAINTS 🛡️ */
    {
      name: "no-services-import-ui",
      severity: "error", // 🔥 CRITICAL LAYER ENFORCEMENT
      comment:
        "The domain service layer must remain presentation-agnostic. Services are strictly forbidden from importing from the UI layer to prevent console layout and logging dependencies from bleeding into business abstractions.",
      from: {
        path: "^src/services/",
      },
      to: {
        path: "^src/ui/",
      },
    },
    {
      name: "defensive-insulation-against-scaffolding",
      severity: "error", // 🔥 REGRESSION DEFENSE
      comment:
        "Codebase structural scaffolding engines and template generators are permanently banned from the CLI runtime commands tree. Blueprint generation belongs exclusively to the Orazaka UI framework workspace.",
      from: {
        path: "^src/(commands|services)/",
      },
      to: {
        path: ".*(scaffold|blueprint-generator|template-engine).*",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)",
      },
    },
  },
};