---
name: build
description: Use when building, bundling or dev-watching an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk), when `opdk build` or `opdk assert-bundle` fails, when a plugin works on desktop but breaks on mobile ("process is not defined"), or when migrating a plugin's esbuild, build-css or build-vault scripts to opdk.
---

# opdk build module

Run all commands from the plugin root. The plugin id and name always come from `manifest.json`.

## Commands

- `opdk build`: CSS, then esbuild, then the bundle check. Exits 1 on esbuild errors or a failed check.
- `opdk build --vault [dir]` (also `--vault=<dir>`): unminified `main.js` in `dir` (default `$VAULT_PLUGIN`), then rebuilds `styles.css` and copies `styles.css` and `manifest.json` there. No bundle check. Without `dir` and `VAULT_PLUGIN` it fails and prints the example with the plugin id. With `build.css: false` it copies a `styles.css` from the plugin root if there is one.
  - Caution: `VAULT_PLUGIN` is usually exported in your shell and points at a real dev vault. The command logs `vault target <dir> (from --vault | from VAULT_PLUGIN)` and refuses (exit 1, nothing written) a `dir` whose `manifest.json` holds another plugin id. `--force` overrides that. It also refuses a `dir` that resolves to the plugin root or starts with `~` (not expanded), even with `--force`. When testing or demoing, pass an explicit temp dir or run with `env -u VAULT_PLUGIN`; never use `--force` against a real vault.
- `opdk build --vault [dir] --watch`: the same, rebuilt on changes to the sources, the CSS entry and every file it imports (polled every 300 ms), and `manifest.json`. If the CSS entry is missing at start it prints `no <entry>, CSS not watched` once. Ctrl+C stops it. `opdk.config.mjs` is read once, so restart watch after editing it. `--watch` without `--vault` is an error.
- `opdk build-css`: only the CSS step. Exits 1 when the CSS entry does not exist. With `css: false` it prints that CSS is disabled and exits 0.
- `opdk assert-bundle [file]`: only the check. `file` defaults to the build outfile.

## Not configurable

Platform `browser`, format `cjs`, the footer `module.exports = module.exports.default || module.exports;`, externals `obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`.

## Config (`opdk.config.mjs`, `build` section, all optional)

| Key | Default |
|---|---|
| `entry` | `src/main.ts` |
| `outfile` | `main.js` |
| `minify` | `true` |
| `target` | `es2020` |
| `external` | `[]` (added to the externals above) |
| `loader` | `{ ".css": "text" }`; your entries merge over it, for example `{ ".png": "dataurl" }` |
| `css` | `{ entry: "src/styles/main.css", outfile: "styles.css" }`, or `false` to skip. |

```js
import { defineConfig } from "obsidian-plugin-dev-kit";
export default defineConfig({ build: { loader: { ".png": "dataurl" } } });
```

If the CSS entry does not exist, `opdk build` says "no src/styles/main.css, keeping styles.css as is" and keeps a hand-written `styles.css` (Dashy's script failed with ENOENT here). Watch survives a compile error or a broken CSS `@import` and recovers when the file is fixed. A missing `@import` or an import cycle in CSS is an error naming the files.

## The mobile-bundle failure

Phones have no Node: no `process`, `require("node:...")`, `__dirname`. Desktop Obsidian does, so a bundle with Node-only code works on the developer's machine and fails on mobile. Usually it comes from esbuild running with `--platform=node`, which picks the `node` branch of a dependency's `exports` map (this is how Dashy 1.0.0 broke with `yaml`).

`opdk build` ends with the check. A failure looks like this:

```text
✗ bundle  main.js cannot run on mobile:
            - a `process` reference: "process.env"
            - `LOG_TOKENS`, which only the Node build of a dependency contains
          Check the esbuild platform: an Obsidian plugin bundles as `browser`.
```

The `✗` marks the step that failed (it is on stderr, and the exit code is 1); the last line is the hint. Read the lines with `✓` above it as steps that passed. Colour appears in a terminal, with `FORCE_COLOR` (except `0` and `false`), or on GitHub Actions; a non-empty `NO_COLOR` or `TERM=dumb` (without `FORCE_COLOR`) turns it off, and in a plain log you read the same symbols without it. Do not parse this text, use the exit code.

How to read it:

- A `process` / `node:` / `__dirname` line means the bundle reaches for Node. Find which dependency: search `main.js` for the text, or bundle without minify (`build.minify: false`) and read around the match.
- A marker line (`LOG_TOKENS`, `LOG_STREAM`, `emitWarning`) means a dependency's Node build got in. Check that nothing sets the platform to `node` (old scripts, `esbuild.config.mjs`), that the dependency has a `browser` or `default` export condition, or replace it.
- If the plugin really is desktop only, set `"isDesktopOnly": true` in `manifest.json`; the check is then skipped.

## Migrating a plugin's build scripts

1. `npm install --save-dev github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z` (pin an exact tag).
2. Replace the scripts:

| Before | After |
|---|---|
| `"build": "npm run build:css && esbuild src/main.ts --bundle ... && node scripts/assert-bundle.cjs"` (Dashy) | `"build": "opdk build"` |
| `"build": "esbuild src/main.ts --bundle ... --loader:.png=dataurl ..."` (Garmy) | `"build": "opdk build"` plus `build: { loader: { ".png": "dataurl" } }` in `opdk.config.mjs`; no `src/styles` is fine |
| `"build:vault": "node scripts/build-vault.cjs"` / `"dev:vault": "... --watch"` | `"build:vault": "opdk build --vault"`, `"dev:vault": "opdk build --vault --watch"` |
| `"build:css": "node scripts/build-css.cjs"` | `"build:css": "opdk build-css"` |

3. Delete `scripts/assert-bundle.cjs`, `scripts/build-css.cjs` and `scripts/build-vault.cjs` only when nothing else requires them. Run `grep -rn "assert-bundle\|build-css\|build-vault" scripts/ package.json` first. Dashy's `scripts/preview.cjs` requires `build-css.cjs` (`npm run preview`, `preview:watch`) and the kit exports no programmatic CSS build, so keep `build-css.cjs` while another script requires it, or change that script to spawn `opdk build-css`.
4. Differences to expect: the build minifies by default (only Garmy lacks `--minify` today: set `minify: false` or check the output first), platform is always `browser` (Snipsy used `node`), and Snipsy needs no `snipsidian` hardcoded in a script because the id is read from `manifest.json`. Snipsy's vault build used to copy the root `styles.css`; the kit rebuilds it from `src/styles` on every sync, so do not hand-edit the root file during `dev:vault`.
5. Snipsy: its current `main.js` fails the bundle check today (`LOG_TOKENS`, `LOG_STREAM`, `emitWarning`, from `--platform=node` plus `yaml`). With the kit it passes because the platform becomes `browser`, which swaps in yaml's browser build. That is a runtime change: smoke-test the migrated Snipsy on a phone. Dashy's and Garmy's bundles pass the check today.
6. If a plugin script still calls esbuild directly (Dashy's `scripts/preview.cjs`), keep its `esbuild` devDependency at the version the kit pins (0.28.2); drop it once no script needs it.
7. Run `opdk build` and test the plugin in Obsidian before releasing.
