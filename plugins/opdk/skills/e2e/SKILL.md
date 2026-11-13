---
name: e2e
description: Set up, write or fix Playwright end-to-end tests for an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk), run in the real Obsidian through Electron. Use it when a spec fails ("Stale build", "Electron binary is not downloaded", "plugin still loading", "Obsidian was not ready", a helper timeout), when a test needs settings, the command palette, the editor, IME input, the mobile layout or a fake plugin client, or when moving a plugin's own e2e fixtures to `obsidian-plugin-dev-kit/e2e`. Not for Vitest unit tests (unit), demo films, GIFs or README stills (demo), build errors (build) or scorecard warnings (scanner).
---

# opdk e2e module

Specs run in the real Obsidian through Electron (`_electron.launch` on Obsidian's `app.asar`). Run commands from the plugin root. The plugin id always comes from `manifest.json`. Full docs: `node_modules/obsidian-plugin-dev-kit/docs/e2e.md`

Safety: `VAULT_PLUGIN` (the dev vault of `opdk build --vault`) is removed from Obsidian's environment by the kit. Every test uses a temp vault copy and a temp user-data folder, never the real vault. When you run anything else that writes into a vault, use `env -u VAULT_PLUGIN`.

## Set up a plugin

1. devDependencies: `@playwright/test` (`^1.62.0`), `electron` (`>=39.0.0`) and the kit pinned to an exact tag. Electron downloads its binary on first use (about 100 MB): run `node node_modules/electron/install.js` once (it only downloads; do not start Electron to fetch it); in CI cache the download (`ELECTRON_CACHE`) and run that command before the tests. Without it the run fails once, before any test, from a global setup that `defineObsidianConfig` registers (a plain Playwright config repeats the failure in every test).
2. A seed vault (any path, set in `seedVault`), for example `e2e/vault/` with `.obsidian/core-plugins.json` containing `["file-explorer", "command-palette"]` (the palette helpers need it) and a note.
3. `e2e/fixtures.ts`:

```ts
import { createObsidianTest } from "obsidian-plugin-dev-kit/e2e";

export const { test, expect, onlyWhen } = createObsidianTest({ seedVault: "e2e/vault" });
```

4. `playwright.config.ts`: `import { defineObsidianConfig } from "obsidian-plugin-dev-kit/e2e"; export default defineObsidianConfig();`
5. Script: `"e2e": "npm run build && playwright test"`. Build first: a `main.js` older than the newest file under `src/` is refused as a stale build (compared by modification time; a test file is one whose name ends in `.test.<ext>` or `.spec.<ext>`; every other file under `src/` counts).
6. Typecheck the specs with `e2e/tsconfig.json` (the root one usually includes only `src/`, and may lack DOM, which `win.evaluate` callbacks reading `document` need):

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "lib": ["ES2020", "DOM", "DOM.Iterable"], "types": ["node"] },
  "include": ["./**/*.ts", "../playwright.config.ts"]
}
```

and `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit"` in `package.json`.
7. A spec:

```ts
import { expect, test } from "./fixtures.js";

test("the command writes into the note", async ({ obsidian }) => {
    await obsidian.openFile("Welcome.md", { mode: "source" });
    await obsidian.runCommand("my-plugin:insert-date");
    expect(await obsidian.editor().text()).toMatch(/\d{4}-\d{2}-\d{2}/);
});
```

## Fixtures

`win` (Playwright `Page` of the Obsidian window), `app` (`ElectronApplication`, `app.evaluate` runs in the main process), `vault` (`path`, `resolve`, `exists`, `read`, `write` on the per-test copy), `obsidian` (the helpers). `vault.write` is plain fs: Obsidian's index (`app.vault.getFileByPath`, the metadata cache) learns of the file only when its watcher fires, so after a write poll for the file first: `await expect.poll(() => obsidian.evaluate((app: App, p: string) => app.vault.getFileByPath(p) !== null, path)).toBe(true)` (`import type { App } from "obsidian"`). Then call `obsidian.waitForMetadataCache()` where the links, tags or frontmatter matter (it only loops over files already indexed, so it does not replace the poll), before acting through the index. Each test gets a fresh Obsidian, vault copy and user-data folder. It starts when the workspace is laid out and every plugin's `onload()` has finished, so a command or tab added after an `await` in `onload()` exists. It does not wait for what the plugin renders after `onload()`: wait for that in the spec (`expect(locator).toBeVisible()`, `expect.poll`, `waitForFunction`), never with a sleep.

A test that needs extra notes or `app.json` keys at start sets `test.use({ seed: { files: { "Notes/a.md": "# a" }, config: { propertiesInDocument: "hidden" } } })` (file or `describe`): they are in the vault before Obsidian opens, so no `vault.write` plus `obsidian.reload()`. `files` may point into `.obsidian/` (`.obsidian/templates.json`); plugin settings stay in the `data` option.

## Options of `createObsidianTest` (unknown keys fail naming them)

`seedVault` (required, env `OPDK_E2E_VAULT`), `plugins` (`[{ dir, staleBuildCheck? }]`, default the plugin in the current directory), `data` (`data.json` per plugin id, replaces a seeded one), `window` (`{ width, height }`), `obsidianPath` (`app.asar`, env `OBSIDIAN_PATH`; required off macOS), `electronArgs` (not `--user-data-dir`), `version` (explicit `x.y.z`, env `OBSIDIAN_VERSION`; fails the test on another version), `timeouts` (`launch` 45000, `ready` 30000, `close` 5000, `trace` 60000, `helpers.{settings 15000, metadataCache 45000, compose 5000, theme 5000, ui 10000}`), `staleBuildCheck` (default true, applies to the plugin in the current directory only; another `plugins` entry is checked only with its own `staleBuildCheck: true`, and an entry's value wins over the top-level one; env `OPDK_E2E_ALLOW_STALE_BUILD=1` turns every check off for one run), `sweepAfterHours` (default 2, `false` disables).

## Helpers (`obsidian`)

- Settings: `openSettings(tab?)` (plugin id or core tab id; waits for a late-registered tab; returns the settings content locator: use it for lookups inside the tab, and use `win.locator(...)` for `has:` filters across the page and for screenshots of the container; Settings opens in the main window, so those screenshots have another size than from a popout), `closeSettings()`. Settings opens in the main window because the kit sets `settingsPopoutWindow: false` unless the seed vault's `app.json` says otherwise.
- Commands: `runCommand(id)` (fails with close matches for an unknown id, and when `checkCallback` declined), `openCommandPalette()`, `runCommandFromPalette(name)`, `press("Mod+P")`.
- Files and editor: `openFile(path, { mode: "source" | "live" | "preview" })` (Obsidian view state `{ mode: "source", source: false }` is `"live"`, `{ mode: "source", source: true }` is `"source"`, `{ mode: "preview" }` is `"preview"`), `readingView(path?)`, `collapseSidebars()` / `expandSidebars()` (fold or unfold both side panels and wait for it; call before `openFile` when the note needs the whole window), `editor().type / text / clear / setCursor / selection`. `text()` and `clear()` throw `There is no active editor` without a note open in source or live mode. `text()` reads `getValue()`, not the DOM.
- Layout: `checkLayout({ root, overflow?, touchTargets?, focusRing? })` fails with the list of all problems inside `root` (required, must match): horizontal overflow (default on), touch targets under 44 px (default on only after `mobile()`), a Tab stop whose outline or box-shadow (on the element or its `::before`/`::after`; screenshots for range and colour inputs) does not change on focus (default off, it presses Tab; `focusRing: { stayInside: true }` also fails when Tab leaves the root, `focusRing: { ignore }` skips a control, for example `.prompt-input`, Obsidian's palette search field with no ring). Scroll panes are checked for overflow; `overflow: { ignore: "pre" }` leaves out a code block or table that scrolls on purpose. Every check off, or a root that matches nothing, fails. `layoutProblems(options)` returns the list instead. Open and `settle()` the part first. For a human look at the screens of a tour use `demo.still(name, { publish: false })` with a `review-` name prefix.
- IME: `editor().compose(text, { chunking: "word" | "character" })`. It always commits; leaving a composition uncommitted needs a raw CDP session (`win.context().newCDPSession(win)`).
- Appearance and state: `setTheme({ mode, theme? })`, `waitForMetadataCache()`, `clearNotices()`, `hideProperties()`, `scrollThrough(selector?)` (stays at the bottom; do not expect it to scroll back), `settle({ quietMs?, root? })` (waits until the DOM has been quiet for 150 ms, fonts are loaded and the images in view are complete; use it in place of a fixed sleep before a picture; its budget is `timeouts.helpers.ui`; a pause longer than `quietMs` before the render looks settled, so assert on the element or raise `quietMs`; canvas drawing, a chart, is not seen at all, so wait for it yourself by polling a pixel or the chart library's ready flag).
- Reload: `reload()` runs `app:reload` and waits until the new page and every plugin are up; use it instead of waiting for the editor after a reload. Fakes from `replace()` are gone afterwards. `app:reload` reloads without saving: wait until the file is written (`vault.read`) before reloading text you just typed.
- Mobile: `mobile({ width, height, scale })` (default 390 x 844 at 2), `desktop()`. It reloads the window; another width reloads again. A plugin with `isDesktopOnly: true` does not load on mobile and the wait fails naming it. Screenshot size follows the display (1x or 2x), and `scale` does not change it: use `win.screenshot({ scale: "css" })` for pictures of a fixed size. Instead of `webFrame.setZoomFactor`, set the viewport with `mobile({ width, height, scale })` and cut with a `clip` in CSS pixels (450 x 800 at scale 2 is 900 x 1600 on a 2x display).
- Page code: `evaluate(fn, arg?)` runs `fn(app, arg)` in the page with `app` = `window.app`; type it with a type-only `import type { App } from "obsidian"` (the kit does not depend on `obsidian`). `fn` is serialised as source text: no closures, no imports, pass values in `arg`; `arg` and the result must be serialisable (return fields, not a `TFile`).
- Obsidian internals (`app.plugins.enablePlugin`, `app.setting`, `app.commands`, `app.internalPlugins`, `vault.getConfig`): type `app` as `AppWithInternals` from `obsidian-plugin-dev-kit/e2e` (`AppWithInternals<PluginInstance & { settings?: MySettings }>` for your plugin's own members) through `obsidian.evaluate((app: AppWithInternals) => ...)`, with no cast, instead of declaring a copy of the interface in the spec or casting `globalThis` through `unknown`.

```ts
import type { App } from "obsidian";

const count = await obsidian.evaluate((app: App, folder: string) => app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(folder)).length, "Notes/");
```

- Fakes: `replace(pluginId, "path.to.fn", factory, arg?)` returns `{ calls(), restore() }`. The factory runs in the page: it cannot close over test variables or use imports. A variable the factory itself reads fails `replace()` with a message naming it (`the replacement factory threw: X is not defined`). A variable read inside the function it returns fails only when the plugin calls it, inside the plugin's own error handling, so put every value in `arg`. After a window reload `calls()` and `restore()` fail, unless `restore()` ran before it (then `calls()` returns the cached record).

```ts
const fake = await obsidian.replace("my-plugin", "client.fetch", (delayMs: number) => async (path: string) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { path, items: [] };
}, 250);
await obsidian.runCommand("my-plugin:sync");
expect(await fake.calls()).toEqual([["/items"]]);
await fake.restore();
```

The session fixture runs with its own timeout, so Playwright counts its time in a separate slot and the reported test duration covers the test body only; the launch time is in the annotation `obsidian-launch-ms`.

Do not add `waitForTimeout` sleeps: every helper waits on state. If a wait is too short for a slow machine, raise the matching `timeouts` entry (the failure message names it) and keep the helper budgets below the 60 s test timeout.

## Specs that run only on request

`onlyWhen("CAPTURE")` at the top of a spec file skips it unless `CAPTURE=1`, and a skipped file never starts Obsidian. Use it instead of `--grep-invert`.

## Failure artifacts

`defineObsidianConfig` keeps `trace`, `video` and `screenshot` on failure; the kit applies `use.trace` and `use.video` to the Obsidian window itself (Playwright does not for `_electron`). A red test leaves `test-results/<test>/obsidian-trace.zip` (open with `npx playwright show-trace <path>`) and a `.webm`. Playwright's own `trace.zip` has no Obsidian window. Read the trace before guessing.

## Cleanup

Teardown runs on pass, failure, timeout and setup errors: trace stopped (bounded by `timeouts.trace`), Obsidian closed (bounded by `timeouts.close`), the process tree ended, folders removed with retries. A folder or process that survives fails the test naming it. `opdk-e2e-*` temp folders older than `sweepAfterHours` are swept when a worker starts. After a run, `ls $TMPDIR | grep opdk-e2e` should print nothing.

## Common failures

- `Stale build: main.js of "<id>" ... is older than <file>`: run `opdk build` in that plugin's folder. To skip the check for one plugin, set `staleBuildCheck: false` on its `plugins` entry; `OPDK_E2E_ALLOW_STALE_BUILD=1` skips it for all plugins in one run.
- `npm ci` fails with `Permission denied (publickey)` in CI: the lockfile records the kit as `git+ssh://`. Rewrite the URL for one command with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=ssh://git@github.com/ npm ci`; on a CI runner `git config --global url."https://github.com/".insteadOf ssh://git@github.com/` before `npm ci` does the same. Or write the dependency as `git+https://...`. (A public repository installs without it.)
- `Electron is installed ... but its binary is not downloaded yet`: `node node_modules/electron/install.js` once (the message prints the real path when Electron is hoisted).
- `Stopping the Obsidian trace took longer than N ms (timeouts.trace)`: a long traced test; raise `timeouts.trace`.
- `plugin still loading: <id>`: its `onload()` is slow or stuck (a view that is merely not drawn yet is not this: the spec has to wait for it). `plugin not loaded: <id>`: it never started; check `manifest.json` and `main.js`. Raise `timeouts.ready` only for a slow `onload()`.
- `The "Trust author and enable plugins" dialog is open`: the kit's trust flag did not apply on this Obsidian version. Report it with the version. Never click the dialog in a spec.
- `Cannot verify OBSIDIAN_VERSION=...`: the renderer did not answer the version request, so the pinned version could not be checked; the installed version may be right.
- `Obsidian version mismatch: expected X, but Y is running`: the installed Obsidian is not the one pinned.
- `Settings did not open in the main window: Obsidian opened it in a second window`: the seed vault's `app.json` sets `settingsPopoutWindow: true`; set it to false or remove the key.
- `The settings modal did not appear in the main window within N ms. Is a dialog covering the workspace?`: close what covers the workspace, or raise `timeouts.helpers.ui`.

## Migrating a plugin with its own harness

1. Add `@playwright/test`, `electron` and the kit.
2. Replace `e2e/fixtures.ts` with `createObsidianTest`. Delete the vault copy, `obsidian.json`, plugin install and `data.json` seeding (and `e2e-setup.sh`), the launch and dialog handling, the version reader, the folder removal.
3. Replace `playwright.config.ts` with `defineObsidianConfig()` plus only what is the plugin's own (`globalSetup`, other `testDir`).
4. Swap the plugin's helpers for `obsidian.*`: settings opener, palette and command runner, typing and reading the editor, IME loop, theme and metadata waits, notice removal, lazy-block scroll, the `emulateMobile` block, fake clients (`replace`).
5. Replace `--grep-invert` and env `test.skip` with `onlyWhen`. A plugin-specific vault variable becomes `OPDK_E2E_VAULT`.
6. Grep the plugin for callers of the old setup script (`e2e-setup.sh`, a capture script, `package.json` scripts, CI) and replace them with `opdk build`. Delete plugin folders committed or generated in the seed vault (`<seed>/.obsidian/plugins/<id>`; the kit's install overwrites them) and their `.gitignore` line; the seed's `community-plugins.json` is optional.
7. Expect these differences: `onlyWhen` needs the variable to be exactly `1` (old `test.skip(!process.env.X)` gates took any non-empty value); no sleeps (the fixture waits for `onload()`, not for the first render: a spec that relied on a sleep for a render needs its own wait for what it asserts); no Escape or `setEnable` on the trust dialog; cleanup failures are now failing tests; `editor().text()` throws without an editor (a hand-written helper may have returned `""`); `openFile` does not collapse side splits (use `collapseSidebars()`); an asar-version fallback is dropped; `compose()` always commits.
8. Run the specs, fix each difference, list the changes in the plugin's CHANGELOG.

## Limits today

Electron mode only (no CDP yet, so no downloaded Obsidian versions; `version` only checks the installed one, and a plugin whose harness launches over CDP (`E2E_LAUNCH=cdp`) keeps it for that). Verified on macOS with Obsidian 1.14.5; Linux CI later; Windows untested. The Obsidian window opens on screen during a run.
