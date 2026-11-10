# Contributing

Thanks for looking. The kit is used by three plugins that pin it by tag, so every change to a command, a config key or an export reaches real users. The rules below keep `main` releasable at any commit and the history readable.

## Before you start

- For anything bigger than a typo or an obvious bug, open an issue first and describe the problem.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.
- The kit stays generic: it reads the plugin id from `manifest.json` and per-plugin settings from `opdk.config.mjs`. Code that only one plugin needs belongs in that plugin.

## Setup

Node 22.13 or newer, or Node 24 or newer.

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build && npm run smoke
```

All five must pass before you open a pull request; CI runs the same commands.

## Testing

- Unit tests (`npm test`) are deterministic, need no network and open no windows. A test that touches the file system works in a temp directory it creates and removes.
- Tests that create `opdk-e2e-*` folders (the e2e module) put them under `testTmpRoot()` from `src/test-support/test-tmp.ts`. The vitest global setup gives every run its own root, so two runs on one machine do not blame each other, and fails the run if a folder is left in it. That failure is printed by vitest as `error during close` **after** the `Tests N passed` line and the process exits non-zero: a green summary followed by that error is a failed run.
- `npm run e2e:smoke` starts the real Obsidian on `test/e2e-fixture/`. It opens windows, so it is run by hand before a release (`env -u VAULT_PLUGIN npm run e2e:smoke`), never from `npm test` or CI.

## Branches

`main` is protected: changes land only through pull requests with green checks, and nobody force-pushes to it.

Branch from the latest `main` and name the branch `<type>/<short-description>`, lowercase with hyphens:

```
feat/build-watch-mode
fix/assert-bundle-false-positive
docs/readme-build-options
```

One change per branch. If you notice something unrelated, open a separate pull request.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <summary>

<body: why the change is needed, what it affects>
```

- `type`: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- `scope`: the module when there is one: `build`, `scanner`, `e2e`, `demo`, `release`, `cli`, `config`, `deps`.
- `summary`: imperative, lowercase start, no trailing period, the whole first line at most 72 characters.
- Breaking changes: add `!` after the type or scope and a `BREAKING CHANGE:` paragraph in the body. A change is breaking when a plugin that pins the kit could fail after upgrading: a removed or renamed command, flag, config key or export, or a different default.

Example:

```
fix(build): keep styles.css when the plugin has no src/styles

Garmy writes styles.css by hand. Building CSS unconditionally replaced it
with an empty file.
```

## Pull requests

- Pull requests are **squash-merged**. The pull request title becomes the single commit on `main`, so the title must be a valid Conventional Commit; a check enforces it. Commits inside the branch can be anything readable.
- Fill in the template: what and why, how you verified it, the changelog line.
- Add tests for new behaviour and a regression test for a bug fix: a test that fails without the fix.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything a plugin author would notice. The changelog is written by hand, for people; it is not generated from commits.
- Update the README section of the module you changed. Describe only what the code does today.
- Do not bump the version; releases do that.
- Keep the branch up to date by merging `main` into it. Do not force-push a branch that someone has already reviewed.

## Releases

Maintainers only. A release is a pull request titled `chore(release): vX.Y.Z` that bumps `version` in `package.json` and moves the `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD`. After it is merged, the maintainer tags that commit `vX.Y.Z` and pushes the tag; a workflow fails the tag if it does not match `package.json`. Tags are never moved or deleted once pushed: a broken release is fixed by the next version.

The kit follows [Semantic Versioning](https://semver.org/). While the version is `0.x`, a minor bump may contain breaking changes, and the changelog says so.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of this repository.
