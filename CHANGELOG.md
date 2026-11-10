# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Kit tooling: strict TypeScript compiled to `dist/` (built by `prepare`), ESLint with `typescript-eslint` strict and stylistic type-checked rules, Vitest with coverage thresholds of 90% (lines, functions, statements) and 80% (branches).
- `opdk` CLI skeleton: command registry, `--help`, `--version`, `<command> --help`. An unknown command or a failing command exits 1 with a message that names the command and, for an unknown one, points to `opdk --help`; the stack prints only with `OPDK_DEBUG=1`. `bin/opdk.js` is type-checked and prints `✗ opdk: <message>` and exits 1 when the CLI fails to load.
- `opdk.config.mjs` loading with `defineConfig`, unknown top-level keys rejected, and `manifest.json` reading with validation.
- CI on pull requests and pushes to `main` (typecheck, lint, tests, build, pack-and-install smoke), plus a tag check that `vX.Y.Z` matches the `package.json` version.
- `npm run smoke` runs the pack-and-install smoke locally: it builds first, installs the packed tarball into a temp project, calls `npx --no -- opdk` and runs `opdk build` on a tiny fixture plugin.
- Build module: `opdk build` bundles with esbuild for platform `browser` (format `cjs`, the `module.exports` footer, `obsidian`, `electron` and the CodeMirror packages external, minified, target `es2020`), builds CSS, and runs the bundle check. The code comes from Dashy's `build` script and its `assert-bundle.cjs`, `build-css.cjs` and `build-vault.cjs`.
- `opdk assert-bundle [file]` fails when the bundle contains Node-only code (`process`, `node:` imports, `__dirname`, markers of the Node build of `yaml`), the check that would have caught Dashy 1.0.0 on mobile. Skipped for `isDesktopOnly` plugins.
- `opdk build-css` inlines `@import` lines recursively.
- `opdk build --vault [dir] [--watch]` builds an unminified bundle into a dev vault, then rebuilds `styles.css` and copies it and `manifest.json` after every build. `--watch` follows the sources through esbuild and polls (every 300 ms) the CSS entry, every file it imports, and `manifest.json`; imports added or removed while it runs are tracked. `dir` falls back to `VAULT_PLUGIN`. Ctrl+C stops watch cleanly. Editing `opdk.config.mjs` needs a restart of watch.
- `build` section in `opdk.config.mjs`: `entry`, `outfile`, `minify`, `target`, `external`, `loader`, `css`. Defaults match Dashy's release build.
- `esbuild` 0.28.2 as the kit's first runtime dependency, pinned exactly. The plugins already use it, and a plugin installing the kit needs no separate esbuild for `opdk build`.
- `opdk build --vault` logs where the folder came from (`--vault` or `VAULT_PLUGIN`) and refuses, with exit 1 and nothing written, a folder whose `manifest.json` holds another plugin id (`--force` overrides this one), a folder that resolves to the plugin root, a value starting with `~` (nothing expands it) and an empty `--vault ""` / `--vault=`. `--vault=<dir>` is in the usage text, and `--force` is rejected without `--vault`. Dashy's `build-vault.cjs` had no guard, so a `VAULT_PLUGIN` left exported in a shell let one plugin overwrite another in the dev vault.
- Build documentation: Mermaid flowcharts, GIFs recorded with VHS (`npm run docs:media`, needs `vhs` and `ffmpeg`), full options tables and example output in the README.
- Skill `skills/build/SKILL.md`.
- `CommandContext.onInterrupt` (optional) for long-running commands.
- Coloured CLI output through one reporter (`CommandContext.reporter`): `✓` green for a step that passed, `✗` red for one that failed with its hint indented underneath, `·` dim for progress, `!` yellow for a warning. Failures (and esbuild's messages) go to stderr and the `✓ · !` lines to stdout; with `--vault`, `build had N error(s)` therefore moved to stderr. Colour rules: a non-empty `NO_COLOR` turns it off, `FORCE_COLOR` (anything but `0` and `false`) turns it on even on a pipe or with `TERM=dumb`, `TERM=dumb` turns it off, `GITHUB_ACTIONS=true` turns it on, otherwise it needs a terminal. The symbols stay in plain output. The output format is for people and is not a stable interface to parse: use the exit code.

### Changed

Differences from the scripts the plugins have today, per plugin. Anything not listed behaves as before.

- Dashy (`build`, `assert-bundle.cjs`, `build-css.cjs`, `build-vault.cjs`):
  - A missing `@import` is an error that names the importing file (Dashy printed a warning and left the `@import` in the output), and an import cycle is an error (Dashy overflowed the stack). The warning for `@import` of a URL is gone; URL imports stay in place for the browser.
  - A missing CSS entry makes `opdk build` skip the CSS step and keep `styles.css` (`build-css.cjs` died with ENOENT). `opdk build-css` exits 1 with a message that names the entry.
  - The bundle size line is in kilobytes with one decimal (`0.6 KB`), computed from the byte length; Dashy rounded the UTF-16 string length.
  - `--vault` and `--watch` are flags of `opdk build` instead of separate scripts. A vault build prints `built` first and `assets copied` after it, `--watch` survives an initial compile error and recovers when the file is fixed, and with `build.css: false` it copies a `styles.css` from the plugin root if there is one.
- Snipsy (`build`, `scripts/build-css.cjs`, `scripts/build-vault.cjs`):
  - Its `build-css.cjs` is Dashy's file (only the comments differ), so the CSS differences listed for Dashy apply to Snipsy's `npm run build` too.
  - The old script copied the root `styles.css` as is and watched it and `manifest.json` with `watchFile`. The kit rebuilds `styles.css` from `src/styles` on every sync, so a hand edit to the root `styles.css` during `dev:vault` is overwritten.
  - The release and vault bundles become platform `browser` (the `build` script and `build-vault.cjs` both used `node`). The release `main.js` changes: yaml's browser build replaces its Node build, so smoke-test the migrated Snipsy on a phone. `npm run build` gains the bundle check; today's `main.js` fails it and the kit's build passes it.
- Garmy: `opdk build` gains `--minify` and two `@codemirror` externals (`@codemirror/state`, `@codemirror/view`), and needs `loader: { ".png": "dataurl" }` in `opdk.config.mjs`.
- All plugins: `.css` is a `text` loader by default in release and vault builds. Dashy's and Snipsy's vault builds had it; it changes nothing until a plugin imports a `.css` file, and it prevents "No loader is configured for .css". `build.loader` entries merge over it.
