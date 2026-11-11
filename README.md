# obsidian-plugin-dev-kit

Build, lint, release, test and film [Obsidian](https://obsidian.md/) plugins from one dev dependency.

> **Status: work in progress, nothing to install yet.** The code is being moved here from three plugins that each kept their own copy: [Snipsy](https://github.com/Dimagious/snipsidian), [Dashy](https://github.com/Dimagious/dashsidian) and [Garmy](https://github.com/Dimagious/garmidian). The roadmap below shows what is done.

## Why

Every Obsidian plugin needs the same tooling around its code: a bundle that also runs on phones, a lint setup that matches the community plugin scanner, a release workflow, end-to-end tests in a real Obsidian, and a demo GIF for the README. Copying it between plugins works until the copies drift. In the three plugins above, a fix for the mobile build reached two of them and not the third. This kit keeps that tooling in one place and versions it.

## What it will include

| Module | What it does |
|---|---|
| Build | esbuild for the browser platform, so the bundle works on mobile, plus a check that fails if Node-only code gets into `main.js`; CSS build; copy into a dev vault in watch mode |
| Scanner and lint | `opdk scan` runs the community plugin scanner's ESLint configuration and its CSS, source and manifest checks before you release, with `eslint-plugin-obsidianmd` pinned in one place; `obsidianPlugin()` gives your own `eslint.config.js` the same base |
| Release | Version sync between `package.json`, `manifest.json` and `versions.json`, tag checks, and a reusable GitHub release workflow with build provenance |
| Unit tests | A Vitest preset with coverage thresholds, and DOM helpers Obsidian adds (`createEl`, `createDiv`, `setText`) |
| End-to-end tests | Playwright in a real Obsidian through Electron: an isolated vault per test, the trust dialog never shown, readiness by plugin state instead of sleeps, a check of which Obsidian version ran, a trace and a video of the Obsidian window for failures, and helpers for settings, commands, the editor, IME composition, the mobile layout and fakes. Launch over CDP and a mode for recording tests by hand with the Playwright Inspector are planned |
| Demo recording | A visible cursor that moves like a person's, subtitles, slow typing and pauses, plus a script that cuts the take with ffmpeg and exports MP4 and GIF |
| Integration tests | A preset for [obsidian-integration-testing](https://github.com/mnaoumov/obsidian-integration-testing): the same smoke tests on the latest public and catalyst builds, and on Android |
| Agent skills | One Claude Code skill per module, so a coding agent working in your plugin knows how to use the kit |

Your plugin keeps only what is its own: specs, the seed vault and demo scenes.

## Install (planned)

No tag exists yet, so these commands do not work today. Replace `vX.Y.Z` with the first tag once it is out.

```bash
npm install --save-dev github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z
npx opdk --help
```

## Build

`opdk build` builds your plugin's CSS, bundles it with esbuild for the browser platform, and then checks `main.js` for code that only exists under Node. Dashy 1.0.0 failed on every phone because its build passed `--platform=node`: esbuild took the `node` branch of the `yaml` package and bundled code that reads `process.env`. Desktop Obsidian has `process`, so only mobile showed it. The platform is fixed here, and the check fails the build if Node-only code gets in anyway.

![Terminal: opdk build prints the CSS step, the bundle size and "free of Node-only references", then ls shows main.js and styles.css](docs/media/build.gif)

When Node-only code gets into the bundle, the build fails:

![Terminal: opdk build bundles main.js, then prints "cannot run on mobile" with the offending process reference, and the exit code is 1](docs/media/build-check-fails.gif)

Quick start: `npx opdk build`. Details: [docs/build.md](docs/build.md).

## Scanner

`opdk scan` runs the community plugin scanner's own ESLint configuration (published upstream), a CSS check and a few source checks that reproduce findings seen on plugin listings, over the files git tracks. It fails when a step has a finding; the scanner's ESLint warnings count as findings, advisory `!` lines do not. Dashy lost three points of its public score to a joined domain string that no local check saw; this catches that kind of thing before the tag.

![Terminal: opdk scan prints lint, css, code and meta with 0 findings each, then the summary and exit code 0](docs/media/scan.gif)

Quick start: `npx opdk scan`. Details: [docs/scanner.md](docs/scanner.md).

## End-to-end tests

`obsidian-plugin-dev-kit/e2e` runs Playwright specs in the real Obsidian: every test gets its own Obsidian process, a copy of your seed vault and a fresh user-data folder, with your built plugin installed and trusted before the window opens. Obsidian 1.13 moved Settings into a second window and took down five of Dashy's specs at once, and Snipsy pressed Escape on the trust dialog and slept to let plugins load. The kit keeps Settings in the main window, sets the trust flag before the vault loads and waits for every plugin's `onload()` to finish, and a failed test leaves a trace and a video of the Obsidian window.

![Obsidian driven by the kit: in a note, text is typed key by key, the command palette finds a command, a notice appears, and the plugin's settings tab opens](docs/media/e2e.gif)

Quick start: `createObsidianTest({ seedVault })` in `e2e/fixtures.ts`, `defineObsidianConfig()` in `playwright.config.ts`, then `npx playwright test`. Details: [docs/e2e.md](docs/e2e.md).

## Roadmap

- [ ] Wave 1: build, scanner and lint, end-to-end harness, demo recording
  - [x] Build: `opdk build`, `opdk build-css`, `opdk assert-bundle`, dev-vault watch
  - [x] Scanner and lint: `opdk scan`, `obsidianPlugin()`
  - [ ] End-to-end harness: launch, isolation, readiness, trace and video, and the helpers are done; CDP mode is pending
  - [ ] Demo recording
- [ ] Wave 2: release tooling and the reusable workflow
- [ ] Wave 3: integration tests preset
- [ ] Wave 4: unit-test helpers and Obsidian mocks
- [ ] Agent skills for each module, written along with the module

Each module moves to Garmy first, then Dashy, then Snipsy. A plugin may change when it adopts a module (for example, Snipsy's bundle switches to the browser platform); each such change is listed in that plugin's changelog and checked by its end-to-end tests.

## Development

Requires Node 22.13 or newer, or Node 24 or newer.

```bash
npm ci
npm run typecheck   # tsc over src, bin, tests and config files
npm run lint        # eslint, zero warnings allowed
npm test            # vitest with coverage thresholds (90% lines, functions and statements, 80% branches)
npm run build       # cleans dist/ and compiles src/ with tsc
npm run smoke       # builds, packs, installs the tarball into a temp project, runs opdk --help, --version, `opdk build` and `opdk scan` on a fixture, imports defineConfig and `obsidian-plugin-dev-kit/eslint`
npm run docs:media  # re-records the GIFs in docs/media with VHS (needs `vhs` and `ffmpeg`); run `npm run build` first
npm run docs:media:e2e  # re-records docs/media/e2e.gif from a real Obsidian window (needs Obsidian and `ffmpeg`)
npm run e2e:smoke  # the kit's own e2e specs against a real Obsidian; by hand before a release, not in CI
```

`dist/` is not committed. `npm install` from a git tag runs `prepare`, which builds it, so a broken build breaks every plugin install. CI runs the same checks plus the smoke on every pull request.

Releasing: bump `version` in `package.json`, move the `[Unreleased]` entries in `CHANGELOG.md` under the new version, merge, then the owner tags `vX.Y.Z` and pushes the tag. A workflow fails the tag if it differs from `package.json`. Plugins pin the tag, for example `github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z`.

## Credits

The kit's code is moved from the owner's plugins: [Snipsy](https://github.com/Dimagious/snipsidian), [Dashy](https://github.com/Dimagious/dashsidian) and [Garmy](https://github.com/Dimagious/garmidian).

## License

MIT
