# Scanner

`opdk scan` runs, locally, the checks behind the Obsidian community plugin scanner's findings over your repository. Only the ESLint configuration is published upstream (in `eslint-plugin-obsidianmd`); the CSS and manifest checks reproduce findings seen on plugin listings. It exits 1 when a step has a finding: the scanner's ESLint warnings count as findings, advisory `!` lines do not. `obsidianPlugin()` is the ESLint config your plugin uses day to day, built on the same preset.

![Terminal: opdk scan prints lint, css, code and meta with 0 findings each, then the summary and exit code 0](media/scan.gif)

## Why

A plugin's public score dropped from 94% to 91% between 1.1.5 and 1.1.6. The cause was a `["forum", "obsidian", "md"].join(".")` workaround that the scanner reports as "Plugin assembles domain names at runtime from split/joined parts". Nothing local failed, so nobody saw it until the listing changed.

The first fix was a regex gate that guessed at the scanner's rules, and the guess was too narrow. When `eslint-plugin-obsidianmd` 0.5.1 came out, running its own scanner configuration over that plugin found seven warnings the gate had never seen, all in a folder the gate skipped. The listing's 24 CSS warnings came from files the old `!important` check never walked. `opdk scan` takes the guessing out: it runs the scanner's configuration itself, over the same files the scanner reads.

## Quick start

Add the command to `package.json` and run it before every release:

```json
{
  "scripts": {
    "scan": "opdk scan"
  },
  "devDependencies": {
    "eslint": "^10.14.0",
    "typescript": "^6.0.3",
    "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.1.0"
  }
}
```

Replace `vX.Y.Z` with the latest tag and pin it exactly. `eslint` (`^9.19.0 || ^10.0.0`) and `typescript` (`>=4.8.4 <6.1.0`) are peer dependencies of the kit: the scan runs on the ESLint and TypeScript your plugin installs. On ESLint 10, npm may print `ERESOLVE overriding peer dependency` warnings that come from `eslint-plugin-obsidianmd`'s own dependencies; the install still succeeds, and `npm ls` exits 1 for the same reason. The kit cannot change this; if you want quieter installs, set `loglevel=error` in the plugin's `.npmrc`, which also hides other npm warnings. Add `eslint` to your own devDependencies explicitly: without it npm installs ESLint 9 on its own, because the plugins nested under `eslint-plugin-obsidianmd` peer on `^9`. The kit brings `eslint-plugin-obsidianmd` 0.5.1, `typescript-eslint`, `postcss` and `doiuse` itself, pinned, so remove your own copies once nothing else uses them; two copies of `typescript-eslint` are two parsers.

```bash
git add -A      # the scan reads what git tracks
npx opdk scan
```

## What it checks

It reads the files `git ls-files` lists in the plugin folder, minus symlinks (the scanner reads the repository's files, and a link may point outside it). Build output (`main.js`, `coverage/`, `.preview/`) is untracked, so the scanner never sees it and neither does the scan. A new file counts once it is staged.

Run it from the plugin root: `eslint-plugin-obsidianmd` reads `manifest.json` from the current directory when it loads.

| Step | What it runs | Notes |
|---|---|---|
| `lint` | The scanner's ESLint configuration over the tracked files it does not ignore: the `SCANNER_IGNORES` list in `src/scanner/scanner-config.ts`, upstream's 48 entries with `eslint` removed from the tool-config group (see "Differences from the public scorecard"). Notable ones: `**/*.cjs`, `**/*.mjs`, `**/*.cts`, `**/*.mts` (so config files and scripts in those formats are not linted), locale folders (`i18n`, `locale`, `translations`, `l10n`), mocks, `e2e`, tests (`*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/`), `scripts/`, `docs/`, `.obsidian`, `test-vault`, `pkg`, `automation`, build output (`dist`, `build`, `main.js`) and `esbuild.config.mjs`. The root `eslint.config.js` and `eslint.config.ts` are linted; `.mjs`, `.cjs`, `.mts` and `.cts` configs stay ignored by their extension globs | The configuration is the one in `eslint-plugin-obsidianmd`'s docs, version 0.5.1 (see Credits). Every finding fails, warnings too: the scanner turns most rules into warnings and a warning still lowers the score. `@typescript-eslint/no-unsafe-*` and the two command-id rules are on, as in the scanner's newest layer (see "Differences from the public scorecard"). A file no `tsconfig.json` covers is linted without type information, as the scanner does it |
| `css` | Every tracked `.css` file, parsed with PostCSS | `!important`, `:has()`, and features Obsidian's Chromium lacks or supports only partly, from caniuse data through `doiuse`, against Chrome 142 (Electron 39, the Chromium of Obsidian 1.11.4). Comments are parsed out, so prose cannot trip a rule |
| `code` | Two checks on the script files under `src/`, tests excluded. Unlike the lint step, this one does read `.mjs`, `.cjs`, `.mts` and `.cts` files under `src/` | A host assembled from joined strings (`["forum", "md"].join(".")`, `.join("/")`), which no ESLint rule covers. And `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, printed as a warning that does not fail the scan: the scanner's configuration leaves `ban-ts-comment` off. The domain check strips JSDoc and line comments first, so prose does not count; the `@ts-` check reads the raw text, because the directives are comments |
| `meta` | `manifest.json` | The description must not start with the plugin name. The name comes from the manifest |

Findings print as `file:line  rule  message`, grouped by step and sorted by file and line.

## Options

`opdk scan` takes no flags. Settings go under `scan` in `opdk.config.mjs`:

```js
import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    scan: { ignore: ["site/**"] },
});
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ignore` | string[] | `[]` | Globs relative to the plugin root. A tracked file that matches is skipped by every step. Only `*` (not `/`), `**` (anything; `**/` also matches no folder) and `?` are supported; a pattern matches the whole path, so use `**/*.min.js` for any depth. Braces, brackets, `!`, a backslash, `..` and a leading `/` or `./` are rejected |

There is no default ignore: whether the public scanner reads folders such as `site/` is not confirmed, so leaving one out is your decision. The scan does not know which tracked files are plugin code: web assets a repository keeps besides the plugin (a docs site, demos) are checked by the same rules. Fixing them, moving them out of the repository or listing them in `ignore` is each plugin's choice. The scan prints how many files `ignore` skipped.

Three situations stop the scan before any check runs ("is not inside a git repository" or "no files to scan"), and each hint names its own fix. Not a git repository: run `git init` and `git add` the plugin's files, or run opdk from the plugin repository. A repository that tracks nothing in the folder: `git add` the files, or run opdk from the plugin repository. An `ignore` that skips every tracked file: check `scan.ignore` in `opdk.config.mjs`.

## One ESLint config for the plugin: `obsidianPlugin()`

Use the same preset in your own `eslint.config.js`, so `npm run lint` and `opdk scan` agree:

```js
import { obsidianPlugin } from "obsidian-plugin-dev-kit/eslint";

export default [
    ...obsidianPlugin({ rootDir: import.meta.dirname, ignores: ["site/**"] }),
];
```

It is `eslint-plugin-obsidianmd`'s `recommended` preset (which carries ESLint's core rules and typescript-eslint's `recommendedTypeChecked`) plus what three real plugins all added to it: `prefer-window-timers` and `settings-tab/prefer-setting-definitions` as errors, and unused arguments, variables and caught errors as errors unless they start with `_`. Run `eslint . --max-warnings=0` so the warnings the preset leaves count as well.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `rootDir` | string | `process.cwd()` | Folder the tsconfig is looked up from. Pass `import.meta.dirname` so an editor that starts ESLint elsewhere finds it |
| `tsconfig` | string | `"./tsconfig.json"` | tsconfig for the type-aware rules, relative to `rootDir` |
| `ignores` | string[] | `[]` | ESLint globs added to `DEFAULT_IGNORES`, which the entry point also exports so a config can extend or print it. It is what three real plugins all left out of their own lint (the intersection of their lists): `node_modules/**`, `coverage/**`, `dist/**`, `main.js`, `scripts/**`, `src/**/*.test.ts`, `vitest.config.ts`, `e2e/**`, `e2e-vault.pristine/**`, `playwright.config.ts`, `.obsidian-unpacked/**`, `design/**`. Paths only some plugins have (`site/**`, `.preview/**`, `src/test/**`, `tools/**`) go in your own `ignores` |

Do not enable `@typescript-eslint/no-misused-promises` next to it: the preset replaces it with `obsidianmd/no-misused-promises`, which does not count Obsidian's chaining `then` (every `Setting` chain) as a Promise. The preset reads ESLint's core rules from the ESLint resolved next to `eslint-plugin-obsidianmd`. `no-useless-assignment` and `preserve-caught-error` exist in ESLint 9.39 but only ESLint 10 added them to `recommended`, so on 9 enable them yourself.

The import lives under `/eslint`, not in the package root, so reading `opdk.config.mjs` does not load the lint plugins. `opdk scan` itself loads ESLint, `eslint-plugin-obsidianmd` and `doiuse` only when it runs, so `opdk --help`, `opdk build` and the other commands start without them and without reading `manifest.json` through the plugin.

### ESLint 9 nested under eslint-plugin-obsidianmd

If the root has ESLint 10 and `node_modules/eslint-plugin-obsidianmd/node_modules/eslint` is a 9.x (seen in real plugin trees), the preset's core rules come from the nested 9, which lacks `preserve-caught-error`, `no-useless-assignment` and `no-unassigned-vars`. Nothing fails; the rules are just missing. `opdk scan` prints a `!` line naming both versions when the majors differ. Removing the plugin's own, older `eslint-plugin-obsidianmd` devDependency stays the first migration step (drop `typescript-eslint`, `@eslint/js` and `esbuild` at the same time if nothing else uses them), but it is not always enough: one plugin still had a nested 9 after it, another did not. The fix is to add `"overrides": { "eslint": "$eslint" }` to `package.json` and run `npm install` again; check with `npm explain eslint`. `npm dedupe` cannot remove the copy, because `@microsoft/eslint-plugin-sdl`, `eslint-plugin-import` and `eslint-plugin-react` peer on ESLint 9. The alternative is a `js.configs.recommended` block in your own `eslint.config.js`, which needs `@eslint/js` kept or added back.

## Example output

A plugin that passes (the GIF above):

```text
$ opdk scan
· scan    hello-plugin: 4 tracked files
✓ lint    0 findings (2 files, eslint-plugin-obsidianmd 0.5.1)
✓ css     0 findings (1 file)
✓ code    0 findings (1 file)
✓ meta    0 findings (manifest.json)
✓ scan    hello-plugin: 0 findings in 4 tracked files
```

The joined-domain regression again, plus a bare timer, an `!important` and a description that starts with the plugin name:

![Terminal: opdk scan prints one failing finding under each of lint, css, code and meta, then the summary, and the exit code is 1](media/scan-fails.gif)

```text
$ opdk scan
· scan    hello-plugin: 4 tracked files
✗ lint    1 finding (2 files, eslint-plugin-obsidianmd 0.5.1):
            src/main.ts:3  obsidianmd/prefer-window-timers  Use 'window.setTimeout()' instead of 'setTimeout()' for popout window compatibility.
✗ css     1 finding (1 file):
            styles.css:1  css-no-important  `!important` is a scanner warning. Raise the selector's specificity instead.
✗ code    1 finding (1 file):
            src/main.ts:1  no-domain-assembly  Domain or URL assembled from array.join(): the scorecard flags it as evasion. Use a string literal.
✗ meta    1 finding (manifest.json):
            manifest.json:1  manifest-description-no-name-prefix  The description must not start with the plugin name. Current: "Hello is a demo plugin."
✗ scan    hello-plugin: 4 findings, each one lowers the community scorecard.
          Fix them and rerun `opdk scan`. Each line reads file:line  rule  message.
$ echo "exit code: $?"
exit code: 1
```

An advisory finding prints as a `!` line and leaves the exit code alone:

```text
! code    src/stub.ts:1  ts-suppression  TypeScript suppression directive: prefer augmenting Obsidian's types in the plugin.
✓ code    0 findings (2 files)
```

## Differences from the public scorecard

- **Layers.** The scanner keeps layers by submission date. Upstream's docs say the older ones switch `@typescript-eslint/no-unsafe-*` and the command-id rules off, and the newest has them back at `warn`. A plugin's public scorecard (version 1.7.1) lists them, so the kit runs the newest layer: a clean scan here is clean in the older layers too. Before this, `opdk scan` missed those warnings.
- **`eslint.config.js` and `.ts`.** The kit lints them (only these two; `.mjs`, `.cjs`, `.mts` and `.cts` configs stay ignored by the extension globs), with type information, as the live scanner does. That plugin's 1.7.1 scorecard has four `no-unsafe-*` warnings in its root `eslint.config.js` (lines 14 to 17, `any` from an untyped helper), although `eslint-plugin-obsidianmd` 0.5.1's documented ignore list contains `**/eslint.config.*`. The kit follows the live scanner over the 0.5.1 text here (owner decision, 2026-11-11): `eslint` is removed from that ignore entry and the project service has `allowDefaultProject: ["eslint.config.*"]`. A config that the plugin's tsconfig already covers is linted with types through that tsconfig instead (typescript-eslint refuses a file that is both). `opdk scan` on that version reports the same four. Fix them in the file or type the helper.
- **The kit can be stricter.** It uses the `recommended` set of the ESLint that runs it, and ESLint 10 adds `preserve-caught-error` and `no-useless-assignment` to it; it also reports the `moment` ban (`depend/ban-dependencies`). On that version these three are not on the public scorecard, so `opdk scan` reports 12 findings there against the scorecard's 9.
- **Partly supported CSS.** `css-browser-feature/*` findings are real: the public scorecard reports "partially supported" features too (`text-decoration: underline dotted ...`, for one plugin). Only bare `underline` and `none` pass.
- **Browser target.** The scorecard names an Obsidian version per plugin: "Obsidian 1.4.5" for a plugin with `minAppVersion` 1.5.0 and "Obsidian 1.11.4" in listings of plugins with `minAppVersion` 1.13.0. How the scanner maps a plugin to a version is not documented, so the kit checks one target, Chrome 142 (Obsidian 1.11.4). A feature that only an older Chromium lacks can appear on the scorecard of a plugin with a low `minAppVersion` and not here.
- **Not readable offline.** The scorecard tab of a listing is rendered in the browser, so two other plugins' scorecards could not be compared; `opdk scan` is clean on the `src/` of one and reports nothing in the `src/` of the other (its findings are under `site/`).

## Reading a failure

- The `✗` lines and their findings go to stderr, the `✓ · !` lines to stdout, and the exit code is 1 on any failing finding. Do not parse the text; use the exit code.
- A rule such as `obsidianmd/prefer-active-doc` is documented in `eslint-plugin-obsidianmd`. Fix the code, or add a disable comment with a description (the scanner honours them).
- `css-browser-feature/<name>` names the caniuse feature. "Partially supported" means Chrome 142 has it with gaps; read the caniuse notes for that feature before keeping it.
- `parse-error` means ESLint could not read the file. Fix the syntax, or list the file under `scan.ignore` if it is not plugin code.
- `css-syntax` means PostCSS could not parse a stylesheet.

When `eslint-plugin-obsidianmd` is bumped, the mirrored configuration has to be diffed again: a test pins the version it was taken from, so a bump fails the kit's tests until someone does.

## Origin

The ESLint configuration in `opdk scan` mirrors "Community plugin scanner configuration" in `eslint-plugin-obsidianmd` 0.5.1 (`docs/configuration.md`), with the differences listed at the top of `src/scanner/scanner-config.ts`. The ignored paths are upstream's 48 with `eslint` removed from the tool-config group (see "Differences from the public scorecard"); its first three (`main.js`, `**/*.min.js`, `**/{dist,build,out,release}/**`) are its stand-ins for bundled output, and upstream says to drop `main.js` for a plugin written in JavaScript. The CSS, host and manifest checks follow the ones a plugin's own scorecard script grew on 2026-11-09.
