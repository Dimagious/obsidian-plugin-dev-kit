import { createRequire } from "node:module";
import type { Reporter } from "../cli/reporter.js";
import { majorOf } from "./eslint-nesting.js";

/**
 * The community scanner type-checks with TypeScript 6, and TypeScript 6 forces `esModuleInterop` on: `moment(date)`
 * imported from `obsidian` is then not callable, and `no-unsafe-call`, `no-unsafe-member-access` and
 * `no-unsafe-return` fire. Under the plugin's own TypeScript 5.9 the same line reports nothing, so a scan on 5.x
 * would show a clean result the scorecard does not (docs/scanner.md, "Differences from the public scorecard").
 */
export const REQUIRED_TYPESCRIPT_MAJOR = 6;

/** What `opdk scan` prints when the plugin's TypeScript cannot be used: the failure line and the hint under it. */
export interface TypescriptGap {
    readonly message: string;
    readonly hint: string;
}

const UPGRADE_HINT =
    "Run `npm install -D typescript@6`, then fix what `tsc` reports (TS2349 on `moment` imported from obsidian; the typed-call fix is in docs/scanner.md, \"Differences from the public scorecard\").";

/**
 * The failure for a TypeScript the scan must not run on, or `undefined` when it may. `version` is what typescript-eslint
 * resolves in the plugin, or `undefined` when none is installed. A version that cannot be read as a major is let
 * through: the scan should not fail on a pre-release tag it does not understand.
 */
export function describeTypescriptGap(version: string | undefined): TypescriptGap | undefined {
    if (version === undefined) {
        return {
            message: "the plugin has no TypeScript installed, and the scan type-checks with it.",
            hint: "Run `npm install -D typescript@6`: the community scanner type-checks with TypeScript 6.",
        };
    }
    const major = majorOf(version);
    if (major === undefined || major >= REQUIRED_TYPESCRIPT_MAJOR) {
        return undefined;
    }
    return {
        message: `the plugin has TypeScript ${version}, but the community scanner type-checks with TypeScript ${String(REQUIRED_TYPESCRIPT_MAJOR)}, so findings such as \`no-unsafe-call\` on \`moment(...)\` would be missed.`,
        hint: UPGRADE_HINT,
    };
}

/** Loads the `package.json` of the `typescript` that typescript-eslint resolves from the kit's install. Throws when there is none. */
function loadTypescriptManifest(): unknown {
    const fromKit = createRequire(import.meta.url);
    const nextToEstree = createRequire(createRequire(fromKit.resolve("typescript-eslint")).resolve("@typescript-eslint/typescript-estree"));
    return nextToEstree("typescript/package.json");
}

/**
 * The version of the `typescript` that typescript-eslint resolves from the kit's install, which is the plugin's own
 * (a peer dependency of the kit), or `undefined` when there is none. `load` is injectable for tests.
 */
export function readPluginTypescriptVersion(load: () => unknown = loadTypescriptManifest): string | undefined {
    let manifest: unknown;
    try {
        manifest = load();
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") {
            return undefined;
        }
        throw error;
    }
    if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
        return manifest.version;
    }
    throw new Error("the typescript package next to typescript-eslint has no version in its package.json. Reinstall it with `npm install -D typescript@6`.");
}

/**
 * The check `opdk scan` runs before it loads the scan's ESLint plugins: they `require("typescript")` at import, so
 * without a TypeScript the import itself would fail with a bare "Cannot find package". Prints the failure and returns
 * 1 when no TypeScript is installed; an older one is reported by `runScan`, after the tracked files are listed.
 */
export function missingTypescriptPreflight(
    pluginId: string,
    reporter: Reporter,
    read: () => string | undefined = readPluginTypescriptVersion,
): number | undefined {
    if (read() !== undefined) {
        return undefined;
    }
    const gap = describeTypescriptGap(undefined);
    if (gap === undefined) {
        return undefined;
    }
    reporter.failure("scan", `${pluginId}: ${gap.message}`, { hint: gap.hint });
    return 1;
}
