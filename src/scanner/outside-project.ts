import type { ESLint } from "eslint";

/**
 * Kept apart from lint.ts so `opdk release check` (the API check) can use `isOutsideProject` without importing the
 * scanner's lint run. Keep this file free of side effects.
 */

/**
 * typescript-eslint's wording for a file no tsconfig covers. The scanner lints such a file without type
 * information instead of failing, so the retry in `runScannerLint` is keyed on this message; a test pins it
 * against the installed typescript-eslint.
 */
export const PROJECT_SERVICE_MESSAGE = "was not found by the project service";

/**
 * TypeScript's TS18003: the tsconfig's `include` matches no file at all. On Linux the project service
 * reports this instead of `PROJECT_SERVICE_MESSAGE` for a file next to such a tsconfig (seen on GitHub
 * Actions, not on macOS), and the file is just as much outside every project.
 */
export const NO_INPUTS_MESSAGE = "No inputs were found in config file";

/** True when typescript-eslint could not place the file in any tsconfig project, so it must be linted without types. */
export function isOutsideProject(result: ESLint.LintResult): boolean {
    return result.messages.some(
        (message) => message.message.includes(PROJECT_SERVICE_MESSAGE) || message.message.includes(NO_INPUTS_MESSAGE),
    );
}
