import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/test-support/**",
                // Only re-exports.
                "src/index.ts",
                // Binds the CLI to process.argv/stdout/exit code; covered by `npm run smoke`.
                "src/cli/main.ts",
                // Binds the reporter to process.stdout/stderr and their TTY flags; covered by `npm run smoke`.
                "src/cli/process-reporter.ts",
            ],
            thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
        },
    },
});
