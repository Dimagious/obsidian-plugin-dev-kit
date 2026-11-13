import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        // Gives the run its own temp folder (TMPDIR too) and fails the run when a test leaves anything in it.
        globalSetup: ["src/test-support/leftovers-global-setup.ts"],
        // Removes the temp folders a test's helpers made and the test did not remove.
        setupFiles: ["src/test-support/temp-registry-setup.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/test-support/**",
                // Only re-exports.
                "src/index.ts",
                "src/eslint/index.ts",
                "src/e2e/index.ts",
                "src/vitest/index.ts",
                "src/vitest/dom/index.ts",
                // Type declarations only.
                "src/**/*.d.ts",
                // Binds the CLI to process.argv/stdout/exit code; covered by `npm run smoke`.
                "src/cli/main.ts",
                // Binds the reporter to process.stdout/stderr and their TTY flags; covered by `npm run smoke`.
                "src/cli/process-reporter.ts",
            ],
            thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
        },
    },
});
