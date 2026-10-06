import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // --- GLOBAL DIRECTORIES TO IGNORE ---
    ignores: ["dist/**", "node_modules/**", "coverage/**", "var/**"],
  },
  {
    files: ["**/*.ts"],
    rules: {
      // --- CORE SECURITY AND STRUCTURAL TYPING ---
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      
      // --- MONOREPO SYNTAX GOUVERNANCE MATRIX ---
      "no-restricted-syntax": [
        "error",
        // 1. Orazaka Global Invariant: Banning traditional TS Enums
        {
          selector: "TSEnumDeclaration",
          message:
            "Traditional TypeScript enums are strictly banned in Orazaka. Use 'export const MyValues = [...] as const' paired with 'export type MyType = typeof MyValues[number]' to maintain pure, tree-shakable, structural Type-Safe compliance.",
        },
        
        // 2. Temporal Invariant: Forbidding mutation of native Date instances
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^set(Date|Hours|Minutes|Seconds|Milliseconds|Month|FullYear|UTCDate|UTCHours|UTCMinutes|UTCSeconds|UTCMilliseconds|UTCMonth|UTCFullYear|Time)$/]",
          message:
            "Mutating native JavaScript Date instances via set* methods is strictly forbidden in Orazaka. Use date-fns instead.",
        },
        
        // 3. Naming Invariant [ERR-104]: Forbidding redundant prefixes
        {
          selector:
            "ExportNamedDeclaration > :matches(TSInterfaceDeclaration, TSTypeAliasDeclaration, ClassDeclaration, FunctionDeclaration)[id.name=/^Orazaka/]",
          message:
            "[ERR-104] Orazaka prefix is banned on internal types. The module path already establishes ownership. Use clean domain names (e.g., 'Settings' not 'OrazakaSettings').",
        },

        // 4. Terminal Security Invariant: Banning scattered process exits
        {
          selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
          message:
            "Spreading 'process.exit()' calls across down-stream modules is strictly forbidden. Allow errors to bubble up naturally. Process termination must happen exclusively at the application entrypoint (src/index.ts).",
        },
      ],
    },
  },
  // ===========================================================================
  // MODULE-SPECIFIC REFINEMENTS
  // ===========================================================================
  {
    // Layer Isolation: Enforcing presentation-free business logic inside services
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message:
            "Direct 'console.log()' statements are banned inside the service layer. Services must remain presentation-agnostic. Route terminal outputs through dedicated UI layers or abstract event loggers.",
        },
      ],
    },
  },
  {
    // Scope Override: Allowing entrypoints and testing infrastructures to execute exits
    files: ["src/index.ts", "src/commands/**/*.ts"],
    rules: {
      // Overrides the global process.exit restriction for top-level command controllers
      "no-restricted-syntax": "off",
    },
  },
  {
    // Test Configurations Matrix
    files: ["src/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": "off", // Disable constraints within testing boundaries
    },
  }
);