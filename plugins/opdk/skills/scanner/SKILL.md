---
name: scanner
description: Lint an Obsidian plugin for the community plugin scorecard with `opdk scan` and fix its findings. Use it for scorecard or scanner warnings (prefer-active-doc, prefer-window-timers, !important, :has, "assembles domain names"), for setting up `eslint.config.js` with `obsidianPlugin()`, or for replacing a plugin's scorecard-check.cjs and scanner.eslint.config.mjs. Not for build or bundle errors (build), tagging and publishing a release (release), Playwright specs (e2e) or films and screenshots (demo).
---

# opdk scanner module

Run all commands from the plugin root: `eslint-plugin-obsidianmd` reads `manifest.json` from the current directory. The plugin name always comes from `manifest.json`. Full docs: https://github.com/Dimagious/obsidian-plugin-dev-kit/blob/main/docs/scanner.md

## Commands

- `opdk scan`: no flags. Runs four steps over the files `git ls-files` lists in the plugin folder and exits 1 if any step has a finding (warnings from the scanner's ESLint config count):
  - `lint`: the scanner's own ESLint configuration (mirror of `eslint-plugin-obsidianmd` 0.5.1 `docs/configuration.md`, "Community plugin scanner configuration"). Files no tsconfig covers are linted without type information. The scanner's ignore list leaves out `*.cjs`, `*.mjs`, `*.cts`, `*.mts`, tests, `scripts/`, `docs/`, locale folders and build output here.
  - `css`: every tracked `.css`: `!important`, `:has()`, and features Chrome 142 (Obsidian 1.11.4) lacks or supports partly (doiuse).
  - `code`: script files under `src/` (`.mjs`/`.cjs` included, unlike `lint`), tests excluded: a host assembled from `["a","b"].join(".")` (or `"/"`); `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` print as `!` and do not fail.
  - `meta`: `manifest.json` description must not start with the plugin name.
- Findings print as `file:line  rule  message` under a `✗ <step>` line on stderr. Use the exit code, not the text.

## Needs git

Not a git repository, or nothing tracked: the command fails and says to `git init` / `git add`. Untracked files are not scanned: stage new files first. Build output is untracked, so it is skipped, as the scanner skips it.

## Config (`opdk.config.mjs`, `scan` section, optional)

| Key | Default | Meaning |
|---|---|---|
| `ignore` | `[]` | Globs relative to the plugin root (`*`, `**`, `?` only; whole-path match, so `**/*.min.js` for any depth). Matching tracked files are skipped by every step |

```js
import { defineConfig } from "obsidian-plugin-dev-kit";
export default defineConfig({ scan: { ignore: ["site/**"] } });
```

Nothing is ignored by default. Whether the public scanner reads `site/` is unconfirmed, so ignoring it is an explicit choice; say so in the plugin's changelog.

## `obsidianPlugin()` for the plugin's own lint

```js
// eslint.config.js
import { obsidianPlugin } from "obsidian-plugin-dev-kit/eslint";
export default [...obsidianPlugin({ rootDir: import.meta.dirname, ignores: ["site/**"] })];
```

Options: `rootDir` (default `process.cwd()`), `tsconfig` (default `./tsconfig.json`), `ignores` (added to the defaults). It is obsidianmd's `recommended` preset plus `prefer-window-timers` and `settings-tab/prefer-setting-definitions` as errors and strict unused-variable rules. Run `eslint . --max-warnings=0`. Do not enable `@typescript-eslint/no-misused-promises`: the preset swaps in `obsidianmd/no-misused-promises`.

## Fixing common findings

- `obsidianmd/prefer-active-doc`: `document.x` becomes `activeDocument.x` (`window` is left alone).
- `obsidianmd/prefer-window-timers`: `setTimeout(...)` and `activeWindow.setTimeout(...)` become `window.setTimeout(...)`; same for `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`. Only `activeWindow.requestAnimationFrame` and `activeWindow.cancelAnimationFrame` are left alone.
- `obsidianmd/prefer-create-el`: `el.createEl("div", {...})` becomes `el.createDiv({...})`.
- `no-domain-assembly`: write the URL as one string literal.
- `css-no-important`: raise the selector's specificity. `css-no-has`: put a class on the element from TS. `css-browser-feature/<name>`: check the feature on caniuse for Chrome 142; "partially supported" is reported on the public scorecard too. `@typescript-eslint/no-unsafe-*`: an `any` or unresolved type flows into the value; type it.
- `manifest-description-no-name-prefix`: reword the description so it does not begin with the plugin name.
- The scan does not know which tracked files are plugin code: web assets a repository keeps besides the plugin (a docs site, demos) are checked by the same rules. Fixing them, moving them out or listing them under `scan.ignore` is each plugin's choice.

## Migrating a plugin's scripts

1. `npm install --save-dev github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z` (exact tag). Keep `eslint` as the plugin's own devDependency (peer of the kit, `^9.19.0 || ^10.0.0`) and `typescript` (peer, `>=4.8.4 <6.1.0`). Add `eslint` explicitly: without an `eslint` devDependency npm installs ESLint 9 on its own, because the plugins nested under obsidianmd peer on `^9`. Then, in order:
   - (a) Remove the plugin's own `eslint-plugin-obsidianmd`, `typescript-eslint`, `@eslint/js` (unused once `obsidianPlugin()` replaces its config), `postcss`, `doiuse`, and `esbuild` if no script calls it directly. The kit pins them.
   - (b) Run `npm install`. On ESLint 10 it may print `ERESOLVE overriding peer dependency` warnings and `npm ls` exits 1. Both come from obsidianmd's own peers, cannot be fixed in the kit, and the install works. `loglevel=error` in the plugin's `.npmrc` quiets them but hides other warnings too.
   - (c) Run `npm explain eslint`, see step 3.
2. Replace `"scorecard:check": "node scripts/scorecard-check.cjs"` with `"scorecard:check": "opdk scan"`; delete `scripts/scorecard-check.cjs`, and `scripts/scanner.eslint.config.mjs` if present.
3. Replace the plugin's `eslint.config.js` with `obsidianPlugin(...)` plus its own extra blocks; set `lint` to `eslint . --max-warnings=0`. `DEFAULT_IGNORES` is only what all three plugins leave out (12 paths: `node_modules`, `coverage`, `dist`, `main.js`, `scripts`, `src/**/*.test.ts`, `vitest.config.ts`, `e2e`, `e2e-vault.pristine`, `playwright.config.ts`, `.obsidian-unpacked`, `design`). Pass the rest through `ignores`, from each plugin's current `eslint.config.js`:
   - Dashy: `.preview/**`, `.capture/**`, `site/**`, `_site/**`, `src/test/**`.
   - Garmy: `.e2e/**`, `playwright-report/**`, `test-results/**`, `.preview/**`, `.capture/**`, `tools/**`, `site/**`, `_site/**`, `src/test/**`.
   - Snipsy: `.claude/**`, `test-results/**`, `playwright-report/**`, `integration/**`, `src/test/**` (Snipsy's config kept the preset off its test stubs; without it `npm run lint` reports about 270 problems there).
   Then (after step 1 (a) and (b)) run `npm explain eslint`. A nested ESLint 9 under eslint-plugin-obsidianmd is fixed by adding `"overrides": { "eslint": "$eslint" }` to `package.json` and running `npm install` again (`npm dedupe` does not help). Removing the plugin's own obsidianmd (step (a)) stays the first step but is not always enough: Dashy still had the nested 9 after it and needed the override, Garmy did not. The alternative is a `js.configs.recommended` block in the plugin's own config, which needs `@eslint/js` kept or added back (`opdk scan` warns about the mismatch too).
4. Differences to expect: see the "Scanner" entries in the kit's CHANGELOG. In short: the regex checks that an ESLint rule now covers are gone, `site/` is no longer skipped unless listed in `scan.ignore`, and a plugin with no CSS no longer fails. The ESLint step is new for Garmy and Snipsy and reports findings on their committed trees (see the CHANGELOG for the lists).
5. Run `opdk scan` and fix or consciously ignore each finding before releasing.
