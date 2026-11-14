---
name: release
description: Check, cut and publish a GitHub release of an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk) with `opdk release check`, `opdk release patch|minor|major|X.Y.Z`, `opdk release publish` and `opdk release notes`, move a plugin to a newer kit release with `opdk kit upgrade`, and set up the plugin's tag workflow that calls the kit's reusable `release.yml`. Use it to bump the version, tag, publish or verify a release, upgrade the kit (package.json tag, lockfile and workflow pins together), fix a failing `kit` step of the release check ("the kit is not pinned to one release"), resume a release that stopped ("no release workflow run started", "attestation does not verify", "origin rejected the push", "notes do not match the CHANGELOG"), read a failing release check, or move a plugin's own version-sync, make-zip and release-audit scripts to the kit. Not for build or bundle errors (build), scorecard warnings (scanner), Playwright specs (e2e) or films and screenshots (demo).
---

# opdk release module

`opdk release` checks a commit, bumps the version in every file, tags it, pushes only the tag, waits for the kit's reusable workflow, verifies its draft release and publishes it, and pushes the branch last. Run commands from the plugin root. The plugin id and version always come from `manifest.json`. Full docs: `node_modules/obsidian-plugin-dev-kit/docs/release.md`

## Safety

- Pushes are the owner's call. `opdk release patch|minor|major|X.Y.Z` and `opdk release publish` push a tag and a branch and publish a release; do not run them unless the owner asked for that release. `--dry-run` creates no commit or tag, pushes nothing and never calls `gh` (it does fetch from `origin` and ask it for the tag), so it is safe; so is `opdk release check`.
- Never force-push, and never delete or move a tag, a public release or a branch commit. The kit has no force flag. A bad release is fixed by a new patch version.
- Never edit a draft release's assets by hand.
- `opdk kit upgrade` edits `package.json`, the lockfile and the workflow files and runs `npm install`, but never commits or pushes; run it only when the owner asked to move to a kit release, on a clean tree, then show `git diff`. `--dry-run` writes nothing.

## Which command

- "Can this be released?": `opdk release check` (add `--tag X.Y.Z` to compare the tag; CI sets it from `GITHUB_REF_NAME`). Exit 1 with one `✗` line and a hint per problem; `!` lines are warnings.
- "Show me what a release would change": `opdk release patch --dry-run` (or `minor`, `major`, `X.Y.Z`). Runs everything but the commit, the tag and the pushes, prints the diff and restores the files; it still fetches from `origin`.
- "Cut the release": `opdk release patch|minor|major|X.Y.Z`. No `v` prefix, no pre-release version. Needs a clean tree on the default branch, neither behind nor ahead of `origin`, entries under `## [Unreleased]`, and `gh` signed in with write access. It runs the plugin's `npm test` first (`--no-test` skips it; no `test` script is only a warning).
- "Stop at the tag": add `--no-push`; continue later with `opdk release publish`.
- "It stopped": `opdk release publish X.Y.Z` (no version means the one in `manifest.json`). Every step checks what is done, so it is safe to repeat.
- "What goes in the release notes": `opdk release notes [X.Y.Z]` prints the CHANGELOG section.
- "Move to a newer kit release": `opdk kit upgrade --dry-run`, then `opdk kit upgrade [vX.Y.Z]` (latest release when no tag). See "Upgrading the kit".

Flags: `--no-build`, `--no-reproducible`, `--no-api` (check and bump), `--no-test` (bump only), `--tag` (check only), `--dry-run`, `--no-push`, `--timeout <minutes>` (default 20) and `--zip` (bump and publish).

## What the check covers

`versions` (manifest, package.json, lockfile, tag), `versions.json` (exists, current version maps to `minAppVersion`, never lowered; it and the other JSON files the release rewrites must be in `JSON.stringify` format), `manifest` (the official action's rules), `changelog` (a `## [X.Y.Z]` section with an entry), `kit` (package.json tag, the commit the lockfile resolved and every kit `uses:` line in `.github/workflows` name one release; offline), `build` (production build and the Node-only check), `assets`, `reproducible` (working tree against the committed tree, byte for byte) and `api` (`minAppVersion` against the API the code calls; needs `npm ci`). `opdk scan` is separate.

Reading failures:

- `reproducible` mismatch or "the committed tree does not build": a build input is untracked or ignored, or the output holds a path of this machine. Commit or fix it. pnpm, Yarn PnP and a repository without commits fall back to two builds of the working tree with a warning. `export-ignore` and Git LFS inputs make the comparison differ.
- `build` warning that `scripts.build` does not run `opdk build`: make it run `opdk build` (the directory rebuilds with that script, and the push flow compares the assets with an `opdk build` of the tag).
- `api` reports nothing for a plugin that surely uses new API: a tsconfig `paths` entry may point `obsidian` at a stub, which the rule cannot see through.
- `versions.json` missing: create it in the multi-line format the kit writes (two-space indent, one entry per line, final newline; `opdk release <bump>` creates it when missing, but `check` fails without it). An existing entry is never rewritten.
- A changelog problem: entries belong under `## [Unreleased]` before a release; `opdk release <bump>` moves them.
- `kit: the kit is not pinned to one release`: the output lists each place with the commit it names. Run `opdk kit upgrade <tag from package.json>` (or without a tag for the latest release); a workflow pinned to a tag or branch instead of a full SHA is fixed the same way. A plugin that does not call the kit's workflows is not affected.
- `ahead of origin` at the start of `opdk release`: the commits have not run CI. Push them through a pull request, wait for green, pull, rerun.
- `npm test failed`: nothing was changed. Fix the tests; `--no-test` only when they are known to be covered elsewhere.

## Upgrading the kit

The kit is pinned in `package.json` (`github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z`), in the lockfile (a commit) and in each kit `uses: ...@<sha> # vX.Y.Z` line of the workflows. `opdk kit upgrade [vX.Y.Z]` moves all three: it finds the latest `vX.Y.Z` tag with `git ls-remote --tags` (no login), rewrites `package.json`, runs `npm install` for that package (a minute: npm builds the kit; on failure `package.json` and the lockfile are put back, nothing else; run `npm ci` if `node_modules` looks off; without a lockfile npm does not run), rewrites the workflow lines with the new commit and `# vX.Y.Z`, runs the `kit` check, and prints the kit's CHANGELOG sections since the old version. Then: read the changelog, commit on a branch, open a pull request. Configure Dependabot to ignore the kit (a lone bump of one pin breaks the `kit` check; the two `ignore` entries are in docs/ci.md), and learn about new kit releases by watching the kit's releases on GitHub. Refuses a dirty tree (`--dry-run` does not). A plugin on v0.1.0 has no `kit` command (`unknown command "kit"`): run `npx -y -p github:Dimagious/obsidian-plugin-dev-kit#v0.3.1 opdk kit upgrade v0.3.1` once. Docs: `node_modules/obsidian-plugin-dev-kit/docs/ci.md`, section "Updating the kit".

## The push flow and its stops

Order: push the tag only, wait for the plugin's tag workflow (the one that calls the kit's `release.yml`), verify the draft (files, notes equal to the CHANGELOG at the tag, bytes equal to a local `opdk build` of the tag, attestations signed by the kit's `release.yml`), publish it, push the release commit to the default branch.

Every stop prints where it stopped, what is on `origin`, and either `Resume with: opdk release publish X.Y.Z` or says to release a new patch version.

- No workflow run within 3 minutes: the plugin's tag workflow does not call `Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@<full commit SHA of the kit>` (a copy does not work), or Actions are off. Fix the workflow and resume; the tag is not pushed twice.
- Workflow failed, cancelled or timed out: read the printed run URL. Release a new patch version, or re-run the failed jobs on GitHub (a failed run can leave a draft: delete it before re-running; `opdk release` stops when it finds two releases for one tag) and resume. After a timeout, wait for the run and resume with a larger `--timeout`.
- Draft does not match (assets, notes, bytes, attestation): nothing was published. Delete the draft, fix the cause, run `opdk release patch`. Resuming would stop at the same place.
- Public release but `origin` rejected the branch push: `git pull --no-rebase origin <branch>`, then `git push origin <branch>`, and do not rewrite the release commit. If the message says origin refused the push (a branch protection, a repository rule or a server hook), pulling will not help: get the release commit onto the branch the way the rule allows (a pull request, or an account that may bypass it). Never delete the public release.
- `gh` errors at the start: nothing was changed; `gh auth login` or `gh auth switch`, or use `--no-push`.

## Workflow and config

The plugin's tag workflow:

```yaml
name: Release
on:
  push:
    tags: ['*.*.*']
permissions:
  contents: write
  id-token: write
  attestations: write
jobs:
  release:
    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@<full commit SHA of the kit>
```

Inputs: `node-version` (default `"22"`) and `zip` (default `false`; add `--zip` to `opdk release` when on). Call the workflow, never copy it; pin the kit to a full commit SHA.

`opdk.config.mjs`, `release` section: `changelog` (default `CHANGELOG.md`, a path inside the plugin) and `defaultBranch` (default: from `origin/HEAD`; run `git remote set-head origin --auto` if it is unset).

## Migrating a plugin's scripts

Replace `version-sync.cjs` and `assert-versions.cjs` with `opdk release`, delete `make-zip.cjs` and `release-audit.cjs` (no zip by default), replace the plugin's `release.yml` with the caller above, make `scripts.build` run `opdk build`. The kit's workflow runs the release check and the build, not the plugin's tests or lint (`opdk release` itself runs `npm test` before the bump): keep those in branch CI (the kit's reusable `plugin-ci.yml` runs them with the release check, see `node_modules/obsidian-plugin-dev-kit/docs/ci.md`). Plugin-specific steps (generated files, a MAJOR-bump checklist) stay in the plugin and run before `opdk release`, because it needs a clean tree and its release commit holds only the version bump. A generated file that names the plugin version (a generated skill or reference file checked in CI with `--check`) has to be regenerated and committed after `opdk release`, or CI fails. If the plugin has no `versions.json` yet, create it first, multi-line (two-space indent, final newline), not on one line.
