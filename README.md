# obsidian-plugin-dev-kit

Build, lint, release, test and film [Obsidian](https://obsidian.md/) plugins from one dev dependency.

> **Status: work in progress, nothing to install yet.** The code is being moved here from three plugins that each kept their own copy: [Snipsy](https://github.com/Dimagious/snipsidian), [Dashy](https://github.com/Dimagious/dashsidian) and [Garmy](https://github.com/Dimagious/garmidian). The roadmap below shows what is done.

## Why

Every Obsidian plugin needs the same tooling around its code: a bundle that also runs on phones, a lint setup that matches the community plugin scanner, a release workflow, end-to-end tests in a real Obsidian, and a demo GIF for the README. Copying it between plugins works until the copies drift. In the three plugins above, a fix for the mobile build reached two of them and not the third. This kit keeps that tooling in one place and versions it.

## What it will include

| Module | What it does |
|---|---|
| Build | esbuild for the browser platform, so the bundle works on mobile, plus a check that fails if Node-only code gets into `main.js`; CSS build; copy into a dev vault in watch mode |
| Scanner and lint | An ESLint config that matches the community plugin scanner's, with `eslint-plugin-obsidianmd` pinned in one place, and a scorecard check that runs before you release |
| Release | Version sync between `package.json`, `manifest.json` and `versions.json`, tag checks, and a reusable GitHub release workflow with build provenance |
| Unit tests | A Vitest preset with coverage thresholds, and DOM helpers Obsidian adds (`createEl`, `createDiv`, `setText`) |
| End-to-end tests | Playwright in a real Obsidian: an isolated vault per test, the trust dialog handled, a check of which Obsidian version ran, launch through Electron or CDP, IME composition input, and a mode for recording tests by hand with the Playwright Inspector |
| Demo recording | A visible cursor that moves like a person's, subtitles, slow typing and pauses, plus a script that cuts the take and adds a voice-over per scene with ffmpeg, then exports MP4 and GIF |
| Integration tests | A preset for [obsidian-integration-testing](https://github.com/mnaoumov/obsidian-integration-testing): the same smoke tests on the latest public and catalyst builds, and on Android |
| Agent skills | One Claude Code skill per module, so a coding agent working in your plugin knows how to use the kit |

Your plugin keeps only what is its own: specs, the seed vault, demo scenes and voice-over text.

## Install (planned)

```bash
npm install --save-dev github:Dimagious/obsidian-plugin-dev-kit#v0.1.0
npx opdk --help
```

## Roadmap

- [ ] Wave 1: build, scanner and lint, end-to-end harness, demo recording
- [ ] Wave 2: release tooling and the reusable workflow
- [ ] Wave 3: integration tests preset
- [ ] Wave 4: unit-test helpers and Obsidian mocks
- [ ] Agent skills for each module, written along with the module

Each module moves to Garmy first, then Dashy, then Snipsy, with no change in how the plugins behave.

## Credits

The kit uses or borrows from: [obsidian-integration-testing](https://github.com/mnaoumov/obsidian-integration-testing) and [obsidian-dev-toolkit](https://github.com/mnaoumov/obsidian-dev-toolkit) by Michael Naumov, the [community plugin scanner configuration](https://github.com/obsidianmd/eslint-plugin) from `eslint-plugin-obsidianmd`, and [Playwright](https://playwright.dev/).

## License

MIT
