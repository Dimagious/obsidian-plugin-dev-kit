import type { Linter } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

/** Settings of `obsidianPlugin()`. Every key is optional. */
export interface ObsidianPluginOptions {
    /**
     * Folder the tsconfig is looked up from. Default `process.cwd()`, which is the plugin root when ESLint runs
     * from there; pass `import.meta.dirname` so an editor that starts ESLint elsewhere finds it too.
     */
    readonly rootDir?: string;
    /** tsconfig for the type-aware rules, relative to `rootDir`. Default `"./tsconfig.json"`. */
    readonly tsconfig?: string;
    /** Added to {@link DEFAULT_IGNORES}. Patterns are ESLint globs relative to the plugin root. */
    readonly ignores?: readonly string[];
}

/**
 * What every plugin on the kit leaves out of linting (the intersection of their lists, not the union): dependencies and build output, unit-test files, e2e folders, scripts, and the config files of the test
 * runners (they are not in the tsconfig). Paths only some plugins have (`site/**`, `.preview/**`,
 * `src/test/**`, `tools/**`, `integration/**`) belong in that plugin's `ignores` option.
 */
export const DEFAULT_IGNORES: readonly string[] = [
    "node_modules/**",
    "coverage/**",
    "dist/**",
    "main.js",
    "scripts/**",
    "src/**/*.test.ts",
    "vitest.config.ts",
    "e2e/**",
    "e2e-vault.pristine/**",
    "playwright.config.ts",
    ".obsidian-unpacked/**",
    "design/**",
];

export interface ResolvedPluginOptions {
    readonly rootDir: string;
    readonly tsconfig: string;
    readonly ignores: string[];
}

/** Applies the defaults and rejects values of the wrong type, naming the option. */
export function resolveOptions(options: ObsidianPluginOptions, cwd: string): ResolvedPluginOptions {
    const known = ["rootDir", "tsconfig", "ignores"];
    const unknownKeys = Object.keys(options).filter((key) => !known.includes(key));
    if (unknownKeys.length > 0) {
        throw new Error(`obsidianPlugin(): unknown option(s): ${unknownKeys.join(", ")}. Allowed options: ${known.join(", ")}.`);
    }
    const { rootDir = cwd, tsconfig = "./tsconfig.json" } = options;
    const extra: unknown = options.ignores ?? [];
    if (typeof rootDir !== "string" || rootDir === "") {
        throw new Error('obsidianPlugin(): "rootDir" must be a non-empty string, for example import.meta.dirname.');
    }
    if (typeof tsconfig !== "string" || tsconfig === "") {
        throw new Error('obsidianPlugin(): "tsconfig" must be a non-empty string such as "./tsconfig.json".');
    }
    if (!isGlobList(extra)) {
        throw new Error('obsidianPlugin(): "ignores" must be an array of non-empty glob strings.');
    }
    return { rootDir, tsconfig, ignores: [...DEFAULT_IGNORES, ...extra] };
}

function isGlobList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

/**
 * `window.<member>` is allowed for these: `window.open` and the timer functions (`obsidianmd/prefer-window-timers`
 * wants the timers on `window`, a popout window's timer resolves through its own closure).
 */
const WINDOW_MEMBER_EXCEPTIONS = "open|setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame|cancelAnimationFrame";

/** Selector of `no-restricted-syntax` below. A computed access (`window["x"]`) has no `property.name`, so it is reported. */
export const BARE_WINDOW_SELECTOR = `MemberExpression[object.name='window']:not([property.name=/^(${WINDOW_MEMBER_EXCEPTIONS})$/])`;

/**
 * The lint setup the kit's plugins share, as a flat config to spread into the plugin's own
 * `eslint.config.js`:
 *
 * ```js
 * import { obsidianPlugin } from "obsidian-plugin-dev-kit/eslint";
 * export default [...obsidianPlugin({ rootDir: import.meta.dirname })];
 * ```
 *
 * It is eslint-plugin-obsidianmd's `recommended` preset as is (that carries ESLint's core rules and
 * typescript-eslint's `recommendedTypeChecked` for TypeScript), plus the three things all three plugins add:
 * timers on `window` and a settings tab that declares its settings are errors rather than warnings, and unused
 * arguments, variables and caught errors are errors unless they start with `_`. On top of that comes one rule of
 * the kit's own: a bare `window.<member>` is an error (use `activeWindow`; `window.open` and the timer functions
 * are exempt). Turn it off with `"no-restricted-syntax": "off"` in a block after the preset; setting
 * `no-restricted-syntax` yourself replaces it.
 *
 * Do not enable `@typescript-eslint/no-misused-promises` next to it: the preset replaces it with
 * `obsidianmd/no-misused-promises`, which does not count Obsidian's chaining `then` as a Promise.
 */
export function obsidianPlugin(options: ObsidianPluginOptions = {}): Linter.Config[] {
    const { rootDir, tsconfig, ignores } = resolveOptions(options, process.cwd());
    return [
        ...obsidianmd.configs.recommended,
        {
            files: ["**/*.ts", "**/*.tsx"],
            languageOptions: {
                parserOptions: { project: tsconfig, tsconfigRootDir: rootDir },
            },
            rules: {
                // Timers go through `window`, not `activeWindow`: a popout window gets a `window` that resolves
                // correctly through the timer's own closure.
                "obsidianmd/prefer-window-timers": "error",
                // Presence-only check: it flags a PluginSettingTab without a getSettingDefinitions() method.
                "obsidianmd/settings-tab/prefer-setting-definitions": "error",
                // A bare `window` is the main window, which is the wrong one in a popout window, where
                // `activeWindow` is the right one. Plain Obsidian behaviour that every plugin meets. The
                // community scanner does not report it (`prefer-active-doc` covers `document` only), so this is
                // the kit's own rule, not scanner parity. A handler parameter named `window` (the second argument
                // of `workspace.on("window-open")`) is the popout's own window but is reported all the same:
                // rename the binding.
                "no-restricted-syntax": [
                    "error",
                    {
                        selector: BARE_WINDOW_SELECTOR,
                        message: "A bare `window.*` refers to the main window, not the popout window the code runs in. Use `activeWindow.*` (`window.open` and the timer functions are the only exceptions). If `window` is a handler parameter, rename it.",
                    },
                ],
                // Match the scanner's strict no-unused-vars policy: every declared argument must be used (or
                // start with `_`).
                "@typescript-eslint/no-unused-vars": [
                    "error",
                    {
                        args: "all",
                        argsIgnorePattern: "^_",
                        varsIgnorePattern: "^_",
                        caughtErrors: "all",
                        caughtErrorsIgnorePattern: "^_",
                    },
                ],
            },
        },
        { ignores },
    ];
}
