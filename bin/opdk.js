#!/usr/bin/env node
// Thin launcher: the CLI lives in TypeScript under src/ and runs from dist/.
import { existsSync } from "node:fs";

const entry = new URL("../dist/cli/main.js", import.meta.url);

if (!existsSync(entry)) {
    // Nothing from dist/ can be loaded here, so no reporter and no colour; the glyph keeps the failure style.
    console.error(
        "✗ opdk: the kit is not built: run `npm run build` in the kit; when installed from git, npm runs it via `prepare`.",
    );
    process.exit(1);
}

try {
    const { main } = await import(entry.href);
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = process.env.OPDK_DEBUG === "1" && error instanceof Error && error.stack !== undefined
        ? error.stack.split("\n")
        : undefined;
    try {
        const { createProcessReporter } = await import(new URL("../dist/cli/process-reporter.js", import.meta.url).href);
        createProcessReporter().error(`opdk: ${message}`, stack);
    } catch {
        // dist/ is too broken to load the reporter: the message still has to reach the user, uncoloured.
        console.error(`✗ opdk: ${message}`);
        if (stack !== undefined) {
            console.error(stack.join("\n"));
        }
    }
    process.exitCode = 1;
}
