import path from "node:path";

/** The `demo` option of `createObsidianTest`. */
export interface DemoOptions {
    /**
     * Where films and stills are written. Relative to the directory `playwright test` runs in. Default `.opdk/demo`.
     * Add `.opdk/` to the plugin's `.gitignore`: the output holds raw frames of the app and is not meant to be committed.
     */
    readonly outDir?: string;
    /** Device pixels per CSS pixel the frames are shot at, a whole number from 1 to 4. Default 2, so frames are sharp on a 1x monitor too. */
    readonly scale?: number;
    /** CSS selectors that must never be in a picture. A film frame or a still fails when an element matching one is visible. */
    readonly forbiddenSelectors?: readonly string[];
}

/** `DemoOptions` with defaults applied and the output folder absolute. */
export interface ResolvedDemoOptions {
    readonly outDir: string;
    readonly scale: number;
    readonly forbiddenSelectors: readonly string[];
}

export const DEFAULT_DEMO_OUT_DIR = ".opdk/demo";
export const DEFAULT_DEMO_SCALE = 2;
const DEMO_KEYS = ["outDir", "scale", "forbiddenSelectors"];
const SOURCE = "createObsidianTest";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Checks the `demo` option. Pure, like the rest of `resolveOptions`: a typo fails when `fixtures.ts` is imported. */
export function resolveDemoOptions(value: unknown, cwd: string): ResolvedDemoOptions {
    if (value === undefined) {
        return { outDir: path.resolve(cwd, DEFAULT_DEMO_OUT_DIR), scale: DEFAULT_DEMO_SCALE, forbiddenSelectors: [] };
    }
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: "demo" must be an object { outDir, scale, forbiddenSelectors }.`);
    }
    for (const key of Object.keys(value)) {
        if (!DEMO_KEYS.includes(key)) {
            throw new Error(`${SOURCE}: unknown key "demo.${key}". Known keys: ${DEMO_KEYS.join(", ")}.`);
        }
    }
    let outDir = DEFAULT_DEMO_OUT_DIR;
    const givenOutDir = own(value, "outDir");
    if (givenOutDir !== undefined) {
        if (typeof givenOutDir !== "string" || givenOutDir === "") {
            throw new Error(`${SOURCE}: "demo.outDir" must be a non-empty string.`);
        }
        outDir = givenOutDir;
    }
    let scale = DEFAULT_DEMO_SCALE;
    const givenScale = own(value, "scale");
    if (givenScale !== undefined) {
        if (typeof givenScale !== "number" || !Number.isInteger(givenScale) || givenScale < 1 || givenScale > 4) {
            throw new Error(`${SOURCE}: "demo.scale" must be a whole number from 1 to 4.`);
        }
        scale = givenScale;
    }
    const selectors = own(value, "forbiddenSelectors");
    const forbiddenSelectors: string[] = [];
    if (selectors !== undefined) {
        if (!Array.isArray(selectors)) {
            throw new Error(`${SOURCE}: "demo.forbiddenSelectors" must be an array of non-empty CSS selectors.`);
        }
        for (const selector of selectors as unknown[]) {
            if (typeof selector !== "string" || selector.trim() === "") {
                throw new Error(`${SOURCE}: "demo.forbiddenSelectors" must be an array of non-empty CSS selectors.`);
            }
            forbiddenSelectors.push(selector);
        }
    }
    return {
        outDir: path.resolve(cwd, outDir),
        scale,
        forbiddenSelectors,
    };
}
