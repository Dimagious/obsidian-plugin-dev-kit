/**
 * The community plugin scanner's ESLint configuration, which `opdk scan` runs over the plugin.
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
 * - The ignore list is upstream's `globalIgnores` as is (all 48 entries). Its first three, `main.js`,
 *   `**\/*.min.js` and `**\/{dist,build,out,release}/**`, are upstream's stand-ins for bundled and minified
 *   output (the scanner recognises it by name and, in a TypeScript project, by content). A plugin written in
 *   JavaScript should drop `main.js`, as upstream says.
 * - Upstream imports `defineConfig` and `globalIgnores` from "eslint/config"; plain arrays and `{ ignores }`
 *   objects do the same here and work on every ESLint the kit supports.
 * - Every finding counts, whatever its severity. The scanner turns most rules into warnings, and a warning still
 *   lowers the score; `opdk scan` fails on both. Upstream's note says the real scanner downgrades unlisted rules
 *   to `warn`, which does not change what is reported.
 *
 * The scanner keeps its layers for newer submissions (stricter rules) apart; like upstream's snippet this is the
 * configuration they all build on.
 */
import type { Linter } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

/** The eslint-plugin-obsidianmd version this configuration was diffed against. */
export const MIRRORED_OBSIDIANMD_VERSION = "0.5.1";

const CODE_FILES = ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"];

/** The paths the scanner leaves out: upstream's `globalIgnores` list, all 48 entries. */
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
    "**/{astro,babel,commitlint,docusaurus,esbuild,eslint,jest,oxlint,postcss,prettier,rolldown,rollup,stylelint,svelte,tailwind,tsdown,tsup,uno,webpack}.config.*",
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
    /** `false` lints without type information, for files no tsconfig covers. */
    readonly typeAware: boolean;
}

export function createScannerConfig({ cwd, typeAware }: ScannerConfigOptions): Linter.Config[] {
    const config: Linter.Config[] = [
        {
            languageOptions: {
                parserOptions: {
                    projectService: true,
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
                "@typescript-eslint/no-unsafe-member-access": "off",
                "@typescript-eslint/no-unsafe-assignment": "off",
                "@typescript-eslint/no-unsafe-argument": "off",
                "@typescript-eslint/no-unsafe-call": "off",
                "@typescript-eslint/no-unsafe-return": "off",
                "@typescript-eslint/restrict-template-expressions": "off",
                "@typescript-eslint/no-base-to-string": "off",
                "import/no-unresolved": "off",

                // Old plugins should not change their command ids
                "obsidianmd/commands/no-command-in-command-id": "off",
                "obsidianmd/commands/no-plugin-id-in-command-id": "off",
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
