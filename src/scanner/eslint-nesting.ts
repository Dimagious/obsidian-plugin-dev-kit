import { createRequire } from "node:module";
import { ESLint } from "eslint";

/** The major of a version such as `9.39.5` or `10.14.0`, or `undefined` for text that does not start with one. */
export function majorOf(version: string): number | undefined {
    const match = /^v?(\d+)\./.exec(version.trim());
    return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * The warning for an ESLint next to `eslint-plugin-obsidianmd` that is another major than the one that runs, or
 * `undefined` when they agree. The preset takes ESLint's core rules (`builtinRules`) from the ESLint it resolves
 * from its own location, so a nested ESLint 9 under a root ESLint 10 leaves `preserve-caught-error`,
 * `no-useless-assignment` and `no-unassigned-vars` out of `recommended` without any error.
 */
export function describeEslintMismatch(running: string, nested: string): string | undefined {
    const runningMajor = majorOf(running);
    const nestedMajor = majorOf(nested);
    if (runningMajor === undefined || nestedMajor === undefined || runningMajor === nestedMajor) {
        return undefined;
    }
    return `eslint-plugin-obsidianmd reads ESLint's core rules from its own ESLint ${nested}, but ESLint ${running} runs. Rules that only ESLint ${String(Math.max(runningMajor, nestedMajor))} puts in "recommended" (preserve-caught-error, no-useless-assignment, no-unassigned-vars) may be missing from the scan. Add "overrides": { "eslint": "$eslint" } to package.json and run \`npm install\` (npm dedupe cannot move it: other obsidianmd dependencies peer on ESLint 9), or see docs/scanner.md ("ESLint 9 nested under eslint-plugin-obsidianmd").`;
}

/** The version of the `eslint` package that `eslint-plugin-obsidianmd` resolves, from the plugin's own location. */
export function readEslintVersionNextToObsidianmd(): string {
    const fromKit = createRequire(import.meta.url);
    const nextToPlugin = createRequire(fromKit.resolve("eslint-plugin-obsidianmd"));
    const manifest: unknown = nextToPlugin("eslint/package.json");
    if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
        return manifest.version;
    }
    throw new Error("the eslint package next to eslint-plugin-obsidianmd has no version in its package.json");
}

/**
 * The mismatch warning for the installed packages. A probe that fails is reported as a warning too (it says what
 * could not be read): the scan can still run, but the reader should know the check did not.
 */
export function eslintMismatchWarning(
    running: string = ESLint.version,
    readNested: () => string = readEslintVersionNextToObsidianmd,
): string | undefined {
    let nested: string;
    try {
        nested = readNested();
    } catch (error) {
        return `could not read the ESLint version next to eslint-plugin-obsidianmd, so a nested ESLint of another major would go unnoticed: ${error instanceof Error ? error.message : String(error)}`;
    }
    return describeEslintMismatch(running, nested);
}
