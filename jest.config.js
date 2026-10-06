/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "text-summary", "text"],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/__tests__/",
    "/commands/",
    "/types/",
    "chat-stream\\.ws\\.ts$",
    "src/index\\.ts$",
    "src/env\\.ts$",
  ],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2022",
          module: "Node16",
          moduleResolution: "Node16",
          esModuleInterop: true,
          strict: true,
          rootDir: "./src",
          types: ["node", "jest"],
        },
      },
    ],
  },
};
