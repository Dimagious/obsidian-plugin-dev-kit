/** Coverage thresholds in percent. */
export interface CoverageThresholds {
    readonly lines: number;
    readonly functions: number;
    readonly statements: number;
    readonly branches: number;
}

/** What Snipsy, Dashy and Garmy gate on today. A floor, not a goal. */
export const DEFAULT_THRESHOLDS: CoverageThresholds = { lines: 90, functions: 90, statements: 90, branches: 80 };

/** Always left out of coverage: the tests themselves, the test helpers and type declarations. */
export const BASE_COVERAGE_EXCLUDE: readonly string[] = ["**/*.test.ts", "src/test/**", "**/*.d.ts"];

/** The `obsidian` value that selects the obsidian-test-mocks package instead of a plugin stub. */
export const OBSIDIAN_TEST_MOCKS = "obsidian-test-mocks";

export interface UnitCoverageOptions {
    /** Required. Globs of the files the gate counts, for example `["src/**\/*.ts"]`. Unlisted files escape the gate. */
    readonly include: readonly string[];
    /** Added to {@link BASE_COVERAGE_EXCLUDE}. */
    readonly exclude?: readonly string[];
    /** Raise individual thresholds. A value below the default needs `allowLowerThresholds: true`. */
    readonly thresholds?: Partial<CoverageThresholds>;
    /** Lets `thresholds` go below {@link DEFAULT_THRESHOLDS}. Without it a lower value is an error. */
    readonly allowLowerThresholds?: boolean;
    /** Reports written next to `text` and `json-summary`. */
    readonly extraReporters?: readonly ("lcov" | "html")[];
}

export interface UnitConfigOptions {
    /** Required. See {@link UnitCoverageOptions}. */
    readonly coverage: UnitCoverageOptions;
    /**
     * How `import "obsidian"` resolves in tests: a path to the plugin's own stub, relative to `rootDir`, or
     * `"obsidian-test-mocks"` (the package's `vitest-setup` mocks the module and installs the DOM helpers; the
     * package must be a dependency of the plugin, and it needs `dom`). Omitted: no alias.
     */
    readonly obsidian?: string;
    /**
     * Test files that need a DOM, as globs relative to the Vitest root (the folder of `vitest.config.ts`). They run
     * in jsdom with Obsidian's DOM helpers installed; every other test file runs in node. `"all"` puts every test file in jsdom. Omitted or `[]`: all node.
     */
    readonly dom?: readonly string[] | "all";
    /** Test file globs, relative to the Vitest root (the folder of `vitest.config.ts`). Default `["src/**\/*.test.ts"]`. */
    readonly include?: readonly string[];
    /** The folder the `obsidian` stub path is resolved against (nothing else uses it). Default `process.cwd()`; pass `import.meta.dirname`. */
    readonly rootDir?: string;
}

export type ObsidianMode =
    | { readonly kind: "none" }
    | { readonly kind: "stub"; readonly path: string }
    | { readonly kind: "mocks" };

export type DomMode =
    | { readonly kind: "none" }
    | { readonly kind: "all" }
    | { readonly kind: "split"; readonly globs: readonly string[] };

export interface ResolvedUnitOptions {
    readonly rootDir: string;
    readonly include: readonly string[];
    readonly obsidian: ObsidianMode;
    readonly dom: DomMode;
    readonly coverage: {
        readonly include: readonly string[];
        readonly exclude: readonly string[];
        readonly thresholds: CoverageThresholds;
        readonly reporters: readonly string[];
    };
}

const KNOWN = ["coverage", "obsidian", "dom", "include", "rootDir"];
const KNOWN_COVERAGE = ["include", "exclude", "thresholds", "allowLowerThresholds", "extraReporters"];
const THRESHOLD_KEYS = ["lines", "functions", "statements", "branches"] as const;

const COVERAGE_EXAMPLE = 'defineUnitConfig({ coverage: { include: ["src/**/*.ts"], exclude: ["src/main.ts"] } })';

function isGlobList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

function isReporterList(value: unknown): value is ("lcov" | "html")[] {
    return Array.isArray(value) && value.every((name) => name === "lcov" || name === "html");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Applies the defaults and rejects values of the wrong type, naming the option and what to do. */
export function resolveUnitOptions(options: UnitConfigOptions, cwd: string): ResolvedUnitOptions {
    // The options come from a plugin's JavaScript config, so the types alone prove nothing.
    const raw: unknown = options;
    if (!isRecord(raw)) {
        throw new Error(`defineUnitConfig(): options are required. Example: ${COVERAGE_EXAMPLE}.`);
    }
    const unknownKeys = Object.keys(raw).filter((key) => !KNOWN.includes(key));
    if (unknownKeys.length > 0) {
        throw new Error(`defineUnitConfig(): unknown option(s): ${unknownKeys.join(", ")}. Allowed options: ${KNOWN.join(", ")}.`);
    }
    const rootDir = raw.rootDir ?? cwd;
    if (typeof rootDir !== "string" || rootDir === "") {
        throw new Error('defineUnitConfig(): "rootDir" must be a non-empty string, for example import.meta.dirname.');
    }
    const include = raw.include ?? ["src/**/*.test.ts"];
    if (!isGlobList(include) || include.length === 0) {
        throw new Error('defineUnitConfig(): "include" must be a non-empty array of glob strings, for example ["src/**/*.test.ts"].');
    }
    const obsidian = resolveObsidian(raw.obsidian);
    const dom = resolveDom(raw.dom);
    if (obsidian.kind === "mocks" && dom.kind === "none") {
        throw new Error(
            'defineUnitConfig(): obsidian "obsidian-test-mocks" patches the DOM and needs a DOM environment. ' +
                'List the test files that use it in "dom", for example dom: ["src/ui/**/*.test.ts"], or pass dom: "all".',
        );
    }
    return { rootDir, include, obsidian, dom, coverage: resolveCoverage(raw.coverage) };
}

function resolveObsidian(value: unknown): ObsidianMode {
    if (value === undefined) return { kind: "none" };
    if (typeof value !== "string" || value === "") {
        throw new Error(
            'defineUnitConfig(): "obsidian" must be a path to the plugin\'s stub, for example "./src/test/stubs/obsidian.ts", or "obsidian-test-mocks".',
        );
    }
    return value === OBSIDIAN_TEST_MOCKS ? { kind: "mocks" } : { kind: "stub", path: value };
}

function resolveDom(value: unknown): DomMode {
    if (value === undefined) return { kind: "none" };
    if (value === "all") return { kind: "all" };
    if (!isGlobList(value)) {
        throw new Error('defineUnitConfig(): "dom" must be an array of test file globs, for example ["src/ui/**/*.test.ts"], or "all".');
    }
    return value.length === 0 ? { kind: "none" } : { kind: "split", globs: value };
}

function resolveCoverage(value: unknown): ResolvedUnitOptions["coverage"] {
    if (!isRecord(value) || !isGlobList(value.include) || value.include.length === 0) {
        throw new Error(
            `defineUnitConfig(): "coverage.include" is required. Vitest reports only files a test imported unless it is set, ` +
                `so a file no test touches would escape the gate. Example: ${COVERAGE_EXAMPLE}.`,
        );
    }
    const unknownKeys = Object.keys(value).filter((key) => !KNOWN_COVERAGE.includes(key));
    if (unknownKeys.length > 0) {
        throw new Error(
            `defineUnitConfig(): unknown coverage option(s): ${unknownKeys.join(", ")}. Allowed options: ${KNOWN_COVERAGE.join(", ")}.`,
        );
    }
    const exclude = value.exclude ?? [];
    if (!isGlobList(exclude)) {
        throw new Error('defineUnitConfig(): "coverage.exclude" must be an array of non-empty glob strings.');
    }
    const extra = value.extraReporters ?? [];
    if (!isReporterList(extra)) {
        throw new Error('defineUnitConfig(): "coverage.extraReporters" must be an array holding "lcov", "html" or both.');
    }
    return {
        include: value.include,
        exclude: [...BASE_COVERAGE_EXCLUDE, ...exclude],
        thresholds: resolveThresholds(value.thresholds, value.allowLowerThresholds === true),
        reporters: ["text", "json-summary", ...extra],
    };
}

function resolveThresholds(value: unknown, allowLower: boolean): CoverageThresholds {
    if (value === undefined) return DEFAULT_THRESHOLDS;
    if (!isRecord(value)) {
        throw new Error('defineUnitConfig(): "coverage.thresholds" must be an object such as { branches: 85 }.');
    }
    const merged: { -readonly [K in keyof CoverageThresholds]: number } = { ...DEFAULT_THRESHOLDS };
    for (const [key, number] of Object.entries(value)) {
        const name = THRESHOLD_KEYS.find((candidate) => candidate === key);
        if (name === undefined) {
            throw new Error(`defineUnitConfig(): unknown threshold "${key}". Allowed: ${THRESHOLD_KEYS.join(", ")}.`);
        }
        if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100) {
            throw new Error(`defineUnitConfig(): threshold "${key}" must be a number from 0 to 100.`);
        }
        if (number < DEFAULT_THRESHOLDS[name] && !allowLower) {
            throw new Error(
                `defineUnitConfig(): threshold "${key}: ${String(number)}" is below the default ${String(DEFAULT_THRESHOLDS[name])}. ` +
                    "The default is a floor. Raise the coverage, or set allowLowerThresholds: true to lower it on purpose.",
            );
        }
        merged[name] = number;
    }
    return merged;
}
