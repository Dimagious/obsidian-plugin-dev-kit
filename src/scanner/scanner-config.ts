/**
 * The community plugin scanner's ESLint configuration, which `opdk scan` runs over the plugin.
 *
 * Licence: the configuration text is copied from eslint-plugin-obsidianmd (obsidianmd/eslint-plugin, Dynalist Inc.,
 * MIT licence); keep this notice.
 *
 * Mirrors "Full scanner-equivalent configuration" in the section "Community plugin scanner configuration" of
 * eslint-plugin-obsidianmd's docs/configuration.md (https://github.com/obsidianmd/eslint-plugin), version
 * 0.5.1, diffed on 2026-11-10 against the tag's file. Re-diff it on every bump of that package: a test pins the
 * version so a bump cannot go unnoticed.
 *
 * What differs from the upstream text, each on purpose:
 * - `tsconfigRootDir` is the plugin root (upstream's snippet says `process.cwd()`), and the project service is on
 *   from the start, as the scanner has it.
 * - `typeAware: false` is the scanner's own treatment of "files no tsconfig covers": linted without type
 *   information, with typescript-eslint's type-aware rules and the obsidianmd rules that read the type checker
 *   switched off, and core `no-implied-eval` on for TypeScript in place of the type-aware rule. Upstream's
 *   snippet does not do this (ESLint reports "was not found by the project service"). A file that cannot be
 *   parsed fails the retry too, where upstream does not report it.
 * - The ignore list is upstream's `globalIgnores` (48 entries) with one change: `eslint` is removed from the
 *   `**\/{astro,babel,...}.config.*` group, so the plugin's `eslint.config.js` and `.ts` are linted (`.mjs`, `.cjs`,
 *   `.mts` and `.cts` stay ignored by their extension globs), with type information
 *   (`allowDefaultProject`, above). 0.5.1's text ignores it, but the live scanner lints it: Snipsy 1.7.1's public
 *   scorecard reports four `no-unsafe-*` warnings in its `eslint.config.js`. The kit follows the live scanner
 *   (owner decision, 2026-11-11). Re-check this on every bump of the package. Its first three, `main.js`,
 *   `**\/*.min.js` and `**\/{dist,build,out,release}/**`, are upstream's stand-ins for bundled and minified
 *   output (the scanner recognises it by name and, in a TypeScript project, by content). A plugin written in
 *   JavaScript should drop `main.js`, as upstream says.
 * - Upstream imports `defineConfig` and `globalIgnores` from "eslint/config"; plain arrays and `{ ignores }`
 *   objects do the same here and work on every ESLint the kit supports.
 * - Every finding counts, whatever its severity. The scanner turns most rules into warnings, and a warning still
 *   lowers the score; `opdk scan` fails on both. Upstream's note says the real scanner downgrades unlisted rules
 *   to `warn`, which does not change what is reported.
 *
 * The scanner keeps layers by submission date. This is the newest one: upstream's snippet is the configuration all
 * layers build on, and the kit adds what the newest layer changes, so a plugin sees what a plugin submitted today
 * would see. That layer turns `@typescript-eslint/no-unsafe-*` and the two command-id rules back on at `warn`
 * (see the block marked "newest" below); its other additions, the obsidianmd rules at `error`, are already
 * `error` in the recommended config for TypeScript. The older layers report less, so a clean scan here is clean in them too.
 */
import type { Linter } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

/** The eslint-plugin-obsidianmd version this configuration was diffed against. */
export const MIRRORED_OBSIDIANMD_VERSION = "0.5.1";

const CODE_FILES = ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"];

/** The paths the scanner leaves out: upstream's `globalIgnores` list (48 entries, with `eslint` removed from the tool-config group), so the root `eslint.config.js` and `.ts` are linted, as the live scanner does. */
export const SCANNER_IGNORES: readonly string[] = [
    // Upstream marks these three "Not in the scanner's list": its stand-ins for bundled and minified output, which
    // the scanner recognises by name and, in a TypeScript project, by content. Upstream says to drop `main.js`
    // for a plugin written in JavaScript.
    "main.js",
    "**/*.min.js",
    "**/{dist,build,out,release}/**/*.{js,cjs,mjs,jsx}",
    "node_modules",
    "dist",
    "build",
    "pkg",
    "test-vault",
    ".obsidian",
    "**/.obsidian/**",
    "esbuild.config.mjs",
    "version-bump.mjs",
    "**/*.test.*",
    "**/*.tests.*",
    "**/*.spec.*",
    "**/*.specs.*",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/mocks/**",
    "**/__mocks__/**",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.cts",
    "**/*.mts",
    "**/vite*",
    "**/scripts/**",
    "**/docs/**",
    "**/i18n/**",
    "**/i18next/**",
    "**/locale/**",
    "**/locales/**",
    "**/translations/**",
    "**/l10n/**",
    ".pnpm-store",
    "**/*.spec.ts",
    "**/testUtils**",
    "automation/**",
    "**/e2e/**",
    "**/e2e-tests/**",
    "**/*.e2e.*",
    "**/wdio.conf.*",
    "**/wdio.*.conf.*",
    "**/playwright.config.*",
    "**/{astro,babel,commitlint,docusaurus,esbuild,jest,oxlint,postcss,prettier,rolldown,rollup,stylelint,svelte,tailwind,tsdown,tsup,uno,webpack}.config.*",
    "**/{eslint,jest}.*.config.*",
    "**/jest.setup.*",
    "**/.{babelrc,eslintrc,mocharc,prettierrc}.*",
];

/** The obsidianmd rules that read the type checker (`meta.docs.requiresTypeChecking`). */
function typeAwareObsidianRules(): string[] {
    return Object.entries(obsidianmd.rules)
        .filter(([, rule]) => {
            const docs: unknown = rule.meta?.docs;
            return typeof docs === "object" && docs !== null && "requiresTypeChecking" in docs && docs.requiresTypeChecking === true;
        })
        .map(([name]) => `obsidianmd/${name}`);
}

export interface ScannerConfigOptions {
    /** Plugin root: where `tsconfig.json` is looked up from. */
    readonly cwd: string;
    /**
     * Whether the project service may take `eslint.config.*` as a default project (the default). It must be off for
     * a plugin whose tsconfig already covers that file: typescript-eslint then throws "was included by
     * allowDefaultProject but also was found in the project service", and the file is linted again with this off.
     */
    readonly allowDefaultProject?: boolean;
    /** `false` lints without type information, for files no tsconfig covers. */
    readonly typeAware: boolean;
}

export function createScannerConfig({ cwd, typeAware, allowDefaultProject = true }: ScannerConfigOptions): Linter.Config[] {
    const config: Linter.Config[] = [
        {
            languageOptions: {
                parserOptions: {
                    // `allowDefaultProject` lets the plugin's own `eslint.config.*` (usually outside the tsconfig)
                    // be linted with type information, which is what produces the `no-unsafe-*` warnings the
                    // public scorecard shows for it.
                    projectService: { allowDefaultProject: allowDefaultProject ? ["eslint.config.*"] : [] },
                    tsconfigRootDir: cwd,
                },
            },
        },

        ...obsidianmd.configs.recommended,

        {
            files: CODE_FILES,
            rules: {
                // Security: kept as errors
                "no-eval": "error",
                "no-unsanitized/method": "error",
                "no-unsanitized/property": "error",
                "obsidianmd/regex-lookbehind": "error",
                "obsidianmd/no-forbidden-elements": "error",

                // Covered by TypeScript or too noisy
                "no-undef": "off",
                "@typescript-eslint/restrict-template-expressions": "off",
                "@typescript-eslint/no-base-to-string": "off",
                "import/no-unresolved": "off",

                // Newest layer: turns these back on at `warn` (upstream's docs, "Rule severity
                // adjustments"), and the public scorecard of Snipsy 1.7.1 lists them. In 0.5.1's recommended config
                // the five `no-unsafe-*` rules are `error` for TypeScript files only (off under package.json,
                // manifest.json and LICENSE, absent for JavaScript), so they are set here at `warn`: TypeScript and
                // JavaScript (`eslint.config.js` included) both get them as warnings, as the newest layer does. The
                // command-id rules are already `warn` there; they are listed so the layer stays complete.
                "@typescript-eslint/no-unsafe-member-access": "warn",
                "@typescript-eslint/no-unsafe-assignment": "warn",
                "@typescript-eslint/no-unsafe-argument": "warn",
                "@typescript-eslint/no-unsafe-call": "warn",
                "@typescript-eslint/no-unsafe-return": "warn",
                "obsidianmd/commands/no-command-in-command-id": "warn",
                "obsidianmd/commands/no-plugin-id-in-command-id": "warn",
            },
        },
        {
            // Implied eval, once per call: the core rule in JavaScript, typescript-eslint's in TypeScript, where
            // the recommended config turns the core rule off. An "error" for the core rule in the block above
            // would turn it back on in TypeScript and report each call twice.
            files: ["**/*.{js,cjs,mjs,jsx}"],
            rules: { "no-implied-eval": "error" },
        },
        {
            files: ["**/*.{ts,cts,mts,tsx}"],
            rules: { "@typescript-eslint/no-implied-eval": "error" },
        },
    ];

    if (!typeAware) {
        config.push({
            ...tseslint.configs.disableTypeChecked,
            files: CODE_FILES,
            languageOptions: {
                parserOptions: { projectService: false, project: null },
            },
            rules: {
                ...tseslint.configs.disableTypeChecked.rules,
                ...Object.fromEntries(typeAwareObsidianRules().map((name) => [name, "off" as const])),
            },
        });
        // disableTypeChecked turns off `@typescript-eslint/no-implied-eval`; the core rule takes over for
        // TypeScript, where the recommended config leaves it off.
        config.push({ files: ["**/*.{ts,cts,mts,tsx}"], rules: { "no-implied-eval": "error" } });
    }

    config.push(
        {
            // Scanner handles this separately. It must be switched off under the glob the rule actually runs on:
            // manifest.json matches no source glob, so an "off" in the block above would not reach it.
            files: ["manifest.json"],
            rules: { "obsidianmd/validate-manifest": "off" },
        },
        {
            // Same for LICENSE.
            files: ["LICENSE", "LICENSE.md", "LICENSE.txt"],
            rules: { "obsidianmd/validate-license": "off" },
        },
        {
            // The scanner honours disable comments but does not report unused ones
            linterOptions: {
                reportUnusedDisableDirectives: "off",
                reportUnusedInlineConfigs: "off",
            },
        },
        { ignores: [...SCANNER_IGNORES] },
    );
    return config;
}
