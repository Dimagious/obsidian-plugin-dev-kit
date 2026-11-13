import * as nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { createRequire } = nodeModule;

/**
 * The TypeScript the community scanner type-checks with is 6.x, whatever a plugin installs. The difference shows:
 * TypeScript 6 forces `esModuleInterop` on, so `moment(date).format()` imported from `obsidian` is not callable and
 * `no-unsafe-call`, `no-unsafe-member-access` and `no-unsafe-return` fire, while the same line under a plugin's own
 * TypeScript 5.9 reports nothing (docs/scanner.md, "Differences from the public scorecard").
 *
 * typescript-eslint and eslint-plugin-obsidianmd both `require`/`import` a bare `typescript`, so which compiler
 * type-checks is decided by module resolution. The kit carries TypeScript 6 under the name `typescript-6`
 * (`"typescript-6": "npm:typescript@6.0.3"`), and a resolve hook sends every bare `typescript` request of the scan
 * process to it. Hooking resolution rather than passing a compiler to the parser matters because two packages
 * resolve `typescript` themselves and must share one instance: syntax-kind numbers differ between versions.
 */
export const SCAN_TYPESCRIPT_PACKAGE = "typescript-6";

/**
 * Where a bare request for `typescript` (or a file inside it) should go, or `undefined` when the request is for
 * something else. `typescriptDir` is the folder of the TypeScript package the scan uses.
 */
export function redirectTypescript(specifier: string, typescriptDir: string): string | undefined {
    if (specifier === "typescript") {
        return path.join(typescriptDir, "lib", "typescript.js");
    }
    if (specifier.startsWith("typescript/")) {
        return path.join(typescriptDir, specifier.slice("typescript/".length));
    }
    return undefined;
}

export interface TypescriptSource {
    /** Folder of the TypeScript package the scan type-checks with. */
    readonly dir: string;
    /** Its version, such as `6.0.3`. */
    readonly version: string;
    /** Whether the resolve hook that sends `typescript` there is installed. False on a Node without `module.registerHooks` (before 22.15). */
    readonly forced: boolean;
}

let installed: TypescriptSource | undefined;

function readVersion(dir: string): string {
    const manifest: unknown = createRequire(path.join(dir, "package.json"))("./package.json");
    if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
        return manifest.version;
    }
    throw new Error(`[scan] ${dir}/package.json has no version. Reinstall obsidian-plugin-dev-kit.`);
}

/**
 * Makes the rest of this process resolve `typescript` to the kit's TypeScript 6. Call it before anything loads
 * ESLint, typescript-eslint or eslint-plugin-obsidianmd; a later call returns the first result. On a Node without
 * `module.registerHooks` (22.15 and later have it) nothing is hooked and `forced` is false: the scan then runs on the
 * plugin's own TypeScript and says so.
 */
export function useTypescriptSix(): TypescriptSource {
    if (installed !== undefined) {
        return installed;
    }
    let dir: string;
    try {
        dir = path.dirname(createRequire(import.meta.url).resolve(`${SCAN_TYPESCRIPT_PACKAGE}/package.json`));
    } catch (error) {
        throw new Error(
            `[scan] The TypeScript 6 the scan type-checks with (package "${SCAN_TYPESCRIPT_PACKAGE}") is not installed next to obsidian-plugin-dev-kit. Run \`npm install\` in the plugin, or reinstall the kit.`,
            { cause: error },
        );
    }
    const version = readVersion(dir);
    if (typeof nodeModule.registerHooks !== "function") {
        installed = { dir, version, forced: false };
        return installed;
    }
    nodeModule.registerHooks({
        resolve(specifier, context, nextResolve) {
            const target = redirectTypescript(specifier, dir);
            if (target === undefined) {
                return nextResolve(specifier, context);
            }
            // `require` resolves paths, `import` resolves URLs.
            return nextResolve(context.conditions.includes("require") ? target : pathToFileURL(target).href, context);
        },
    });
    installed = { dir, version, forced: true };
    return installed;
}

/** The version of the `typescript` that typescript-eslint resolves when nothing redirects it: the plugin's own. */
export function readTypescriptNextToTypescriptEslint(): string {
    const fromKit = createRequire(import.meta.url);
    const nextToEstree = createRequire(createRequire(fromKit.resolve("typescript-eslint")).resolve("@typescript-eslint/typescript-estree"));
    const manifest: unknown = nextToEstree("typescript/package.json");
    if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
        return manifest.version;
    }
    throw new Error("the typescript package next to typescript-eslint has no version in its package.json");
}

/**
 * The warning for a scan that could not switch to TypeScript 6, or `undefined` when it did (or the compiler in use is
 * already 6). `inUse` is the version of the `typescript` that typescript-eslint resolves.
 */
export function describeTypescriptGap(source: TypescriptSource, inUse: string): string | undefined {
    const major = Number.parseInt(inUse, 10);
    if (source.forced || Number.isNaN(major) || major >= 6) {
        return undefined;
    }
    return `the scan type-checks with TypeScript ${inUse}, but the community scanner uses TypeScript 6 and reports warnings that TypeScript ${String(major)} hides (for example moment(...) imported from obsidian). This Node (${process.version}) has no module.registerHooks, which the kit needs to switch compilers: use Node 22.15 or later, or install typescript@6.0 in the plugin for the check.`;
}
