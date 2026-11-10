import { createReporter, shouldColor, type Reporter } from "./reporter.js";

function isTerminal(stream: { readonly isTTY?: boolean }): boolean {
    return stream.isTTY === true;
}

/**
 * A reporter bound to the real stdout/stderr; colour is decided per stream. Used by `main.ts` and `bin/opdk.js`.
 */
export function createProcessReporter(): Reporter {
    return createReporter({
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        colorStdout: shouldColor({ isTTY: isTerminal(process.stdout), env: process.env }),
        colorStderr: shouldColor({ isTTY: isTerminal(process.stderr), env: process.env }),
    });
}
