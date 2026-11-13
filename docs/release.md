# Releases

`opdk release check` tells you whether a commit can be released. `opdk release patch` (or `minor`, `major`, or an exact `X.Y.Z`) bumps the version in every file, tags the commit, pushes the tag, waits for the kit's reusable GitHub workflow, verifies the draft release it made, publishes it and only then pushes the branch. `opdk release publish` continues that flow after any stop, and `opdk release notes` prints a version's CHANGELOG section.

## Why

Obsidian reads the version from `manifest.json` on the default branch, then downloads `main.js`, `manifest.json` and `styles.css` from the GitHub release with that tag. Since 2026-05 the community directory scans every release. Its [documentation](https://docs.obsidian.md/community-directory/manage-entry) says it verifies that the build matches what is committed, and developers report that `main.js` is compared byte for byte. Hand-written release scripts in real plugins had these problems:

- **Branch and tag were pushed together** (`git push --follow-tags`), so the directory could read the new `manifest.json` before the release workflow had finished, or after it failed.
- **GitHub's release listing can lag behind a successful release.** A plugin's 1.0.2 release failed its directory review with "release is missing the main.js file" although the release had its assets: the list of assets of the release stayed empty for 90 minutes after a successful run. The kit cannot shorten that wait. It makes sure the manifest on the default branch moves only after the release is public.
- **The audit exited 0 on problems.** A `release-audit.cjs` script printed its findings and "READY FOR OBSIDIAN REVIEW ❌", then exited 0 (it exited 1 only when no zip was found), and its zip step dropped a missing `main.js` without a word.
- **`versions.json` entries could be rewritten.** A `version-sync.cjs` script rewrote an existing entry whenever `minAppVersion` changed, including the entry of a released version. Another plugin had no `versions.json` at all and never compared the tag with the manifest.
- **The CHANGELOG never reached the release.** Plugins keep a hand-written CHANGELOG, and the release page showed GitHub's list of pull requests (or only a compare link).
- **Any tag built from any commit.** A tag on a commit outside the default branch was built and published as it was.
- **Attestations were produced and never verified.**

The kit's answer, in the same order: the tag is pushed first and the branch last; the check exits 1 with a hint per problem; a `versions.json` entry is added and never rewritten; the release notes are the CHANGELOG section; the workflow refuses a tag that is not the manifest version on top of the default branch; and the draft's bytes and attestations are verified before it is made public.

## Quick start

1. Install the kit as a dev dependency (see the README) and make `scripts.build` run `opdk build`:

   ```json
   {
     "scripts": {
       "build": "opdk build"
     }
   }
   ```

   The community directory rebuilds `main.js` with the first of `build`, `build:plugin` and `compile` that exists. `opdk release` compares the release assets byte for byte with its own `opdk build` of the tag, so that script has to run `opdk build`.

2. Add a workflow that calls the kit's. The permissions block is required: a called workflow cannot ask for more than its caller grants. Pin the kit to a full commit SHA, not to a branch or a tag name:

   ```yaml
   # .github/workflows/release.yml
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

3. Keep a `CHANGELOG.md` with an `## [Unreleased]` section, and a `versions.json` that maps your current version to `minAppVersion` (see "Requirements").

4. Look at what would stop a release, in CI or by hand:

   ```bash
   npx opdk release check
   ```

5. Cut the release from the default branch with a clean tree:

   ```bash
   npx opdk release patch --dry-run   # everything but the commit, the tag and the pushes; prints the diff
   npx opdk release patch
   ```

## Requirements

- **The GitHub CLI (`gh`)**, signed in with write access to the repository `origin` points at. `opdk release` checks this before it bumps anything, so a missing `gh` leaves the tree as it was. `--no-push` and `--dry-run` skip the check.
- **`origin` is a GitHub URL**: `https://host/<owner>/<repo>[.git]`, `ssh://git@host/<owner>/<repo>[.git]` (also `git://` and `git+ssh://`), or `git@host:<owner>/<repo>[.git]`. The host is ignored, `gh` asks github.com. A local path or a URL with more path segments is refused.
- **`scripts.build` runs `opdk build`** (see Quick start).
- **`versions.json`** exists, is an object, and maps the current version to the manifest's `minAppVersion`. `opdk release <bump>` creates a missing file, but `opdk release check` fails without it, so add it first when you want the check in CI.
- **`CHANGELOG.md`** in Keep a Changelog form: `## [Unreleased]` with entries before a release, `## [X.Y.Z]` after it. The file is `CHANGELOG.md` unless `release.changelog` names another.
- **A tag workflow in the plugin that calls the kit's `release.yml`** (see Quick start). The plugin installs `opdk` as a dev dependency, because the workflow runs `node_modules/.bin/opdk`.
- **Actions enabled** for the repository, with workflow permissions that allow the caller's `permissions` block (Settings, Actions, General).
- A **default branch** git can find: `origin/HEAD`, or `release.defaultBranch`. If `origin/HEAD` is not set, run `git remote set-head origin --auto`.

## `opdk release check`

For CI and for the minute before a release. Exit 1 with one `✗` line and a hint per problem; warnings print as `!` and do not fail.

| Group | What it checks |
|---|---|
| `versions` | `manifest.json`, `package.json` and `package-lock.json` (both version fields) hold the same `x.y.z` version, with no `v` and no pre-release. With `--tag <name>`, or `GITHUB_REF_NAME` when `GITHUB_REF_TYPE=tag`, the tag is that version. A missing lockfile is a warning. `package.json`, `package-lock.json` and `manifest.json` must also be written the way `JSON.stringify` writes them (their own indent, final newline, consistent line endings): `opdk release <bump>` rewrites them and refuses a file it cannot write back as it is |
| `versions.json` | The file exists and is an object; the current version maps to the manifest's `minAppVersion`; `minAppVersion` never goes down as versions go up (errors), and the file is formatted the way `JSON.stringify` writes it, so a one-line `{"1.7.1": "1.5.0"}` fails with a `node -e` command that rewrites it (Prettier would leave it on one line). A key or value that is not a version is a warning, as in the official action |
| `manifest` | The rules of the official [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action (v1.2.3): required fields, `id`, `name` and `description` rules, an `author` without an email or a URL, HTTPS URLs, `isDesktopOnly` a boolean, version not `0.0.0`, `minAppVersion` a version |
| `changelog` | `CHANGELOG.md` has a `## [X.Y.Z]` section with at least one entry |
| `kit` | When the plugin depends on the kit, its three pins name one release: the tag in `package.json`, the commit the lockfile resolved it to, and the commit in every `uses: <owner>/obsidian-plugin-dev-kit/.github/workflows/<file>@<sha> # vX.Y.Z` line of `.github/workflows/*.yml`. It works offline: the lockfile's `version` stands for the tag, and a `# vX.Y.Z` comment must match it. A workflow pinned to a tag or a branch instead of a full commit SHA fails. A plugin that does not use the kit, or does not call its workflows, passes. The failure lists every place with the commit it names and the fix, `opdk kit upgrade` (see [Updating the kit](ci.md#updating-the-kit)) |
| `build` | A production build into temp folders (your `main.js` and `styles.css` are not touched) passes the Node-only bundle check. Warns when `scripts.build` (else `build:plugin`, else `compile`) does not run `opdk build` |
| `assets` | `main.js` is produced, `styles.css` when the plugin has CSS, and the manifest asset is the root `manifest.json` |
| `reproducible` | The working tree is built, then the committed tree, and `main.js` and `styles.css` must match byte for byte |
| `api` | `minAppVersion` against the API the code calls (`obsidianmd/no-unsupported-api`) |

`opdk scan` is not part of the check. Run it separately.

### Where the manifest rules differ from the official action

The kit follows the action's `src/manifest.ts` with these differences:

- `author`, `minAppVersion` and `isDesktopOnly` are required. The action only recommends them.
- A banned word in the `id` is a warning, in the `name` an error.
- `helpUrl` is accepted and its URL is checked.
- `authorUrl`, `helpUrl` and `fundingUrl` of the wrong type (an array, a number) are errors.
- The action's check that `authorUrl` is not the plugin's own repository is covered by the general warning that `authorUrl` links to a repository.

### Reproducibility, and what it does not prove

The directory rebuilds your plugin from the tagged commit. A build that depends on something git does not hold passes on your machine and fails there. The check builds the working tree, then extracts `git archive HEAD` into another temp folder (with your `node_modules` linked in) and builds that. A mismatch names the first differing offset and the likely causes. It catches an untracked or ignored file that a build input needs (the committed tree does not build) and absolute paths of this machine in the output.

Its limits:

- It reuses this machine's `node_modules`, so it does not compare the Node or esbuild version, lockfile drift, or line endings on another operating system.
- With uncommitted changes, the committed tree is what is compared and the output says so.
- Outside a git repository, or before the first commit, it builds the working tree twice and warns that this proves much less.
- pnpm and Yarn PnP installs fall back to two builds of the working tree, with a warning that names the layout, because their packages cannot be linked into a copy.
- `git archive` applies `export-ignore` from `.gitattributes`, and Git LFS files are pointer text in it. A build input that is ignored on export, or tracked by LFS, makes the comparison differ.

When `opdk release` publishes, the assets are compared again, this time with GitHub's build of the tag (see step 8 below).

### The build script warning

The directory rebuilds `main.js` with `scripts.build` (else `build:plugin`, else `compile`). If that script does not run `opdk build`, the check prints a warning, because the bytes the directory builds may differ from the bytes the kit builds and verifies.

### The API check and its blind spot

`obsidianmd/no-unsupported-api` runs type-aware against the manifest's `minAppVersion`, over the files esbuild puts into `main.js` (read from its metafile, `node_modules` excluded). It needs `npm ci` first. A shipped file that no tsconfig covers is an error.

The rule reads `@since` tags from `obsidian.d.ts` through the TypeScript program. When the program does not contain the real `obsidian.d.ts` (for example a tsconfig `paths` entry that points `obsidian` at a stub), the rule reports nothing and the check cannot tell.

### Skipping parts

| Flag | Skips |
|---|---|
| `--no-build` | `build`, `assets` and `reproducible` (a quick CI step) |
| `--no-reproducible` | the second build: it builds once |
| `--no-api` | the API check |

The version, `versions.json`, manifest, kit and changelog checks always run.

## `opdk release <bump>`

`<bump>` is `patch`, `minor`, `major` or an exact `X.Y.Z`. A `v` prefix and pre-release versions are refused with a message that says what to type.

1. **Preflight.** The folder is a git repository with a clean tree, on the default branch, neither behind nor ahead of `origin` (it runs `git fetch --no-tags origin`, never a push), the tag does not exist locally or on `origin`, the three versions agree before the bump, the new version is higher than the current one, and `## [Unreleased]` has entries. Every problem prints with a hint. Then `gh` access is checked (skipped with `--no-push` and `--dry-run`). Commits that `origin` has not seen are refused, not warned about: the tag is pushed before the branch, so they would reach the release workflow without having run in the branch's CI. Push them through a pull request, wait for CI, pull, and rerun.
2. **Tests.** `npm test` runs on the tree as it is, with its output on the terminal, before any file changes. A failure stops the release with nothing modified. CI already ran the tests for the pushed commits; this run protects the release commit on your machine. `--no-test` skips it, and a `package.json` without a `test` script prints a warning and goes on. A dry run runs the tests too.
3. **Bump.** The version is set in `package.json`, `package-lock.json` and `manifest.json`. It is added to `versions.json` mapped to `minAppVersion`: an existing entry is never rewritten, and a missing file is created. The `[Unreleased]` entries move under `## [X.Y.Z] - YYYY-MM-DD`, leaving an empty `[Unreleased]`, and the compare links at the bottom are updated when the file has them.
4. **Check.** `opdk release check` runs on the result, with the bumped files laid over the committed tree so that tree matches the commit to come. When it fails, or on Ctrl+C (exit 130), the files are restored, the temp folders are removed and nothing is committed.
5. **Commit and tag.** `chore(release): X.Y.Z`, then the annotated tag object `X.Y.Z`. With `--no-push` the command stops here. With `--dry-run` it stops before the commit, prints the diff and restores the files: no commit or tag is created, nothing is pushed and `gh` is never called, but preflight still fetches from `origin` and asks it for the tag (`ls-remote`).
6. **Push the tag.** Only `git push origin refs/tags/X.Y.Z`. The branch waits. There is no force flag in the code, and a tag on `origin` that is not this tag object (it points elsewhere) stops the flow.
7. **Wait for the workflow.** The run is found by the tagged commit and the tag (`head_branch`), among the runs whose `referenced_workflows` include the kit's `release.yml`. Other workflows on the same push, such as a Pages deploy, are not waited for. If no such run starts within 3 minutes, the plugin's tag workflow does not call the kit's. A progress line prints whenever the state changes, and every minute while it does not. The default wait is 20 minutes (`--timeout <minutes>`).
8. **Verify the draft.**
   - It holds `main.js`, `manifest.json` and `styles.css` only when the plugin has CSS, each uploaded and not empty, and nothing else (`--zip` also expects `<id>-<version>.zip`). Two releases for one tag stop the flow. A release that is already public (a resume) is verified the same way.
   - Its notes equal the `## [X.Y.Z]` section of the CHANGELOG as committed at the tag (trailing whitespace aside).
   - The assets are downloaded and compared byte for byte with a build of the tagged commit made on your machine (`git archive` of the tag, built like the reproducibility check does) and with the committed `manifest.json`. The zip is checked for presence and size only.
   - `gh attestation verify` runs for each attested file against the repository, the tag ref, the tagged commit and the signer. The signer identity must match `^https://github\.com/Dimagious/obsidian-plugin-dev-kit/\.github/workflows/release\.yml@`: the kit's `release.yml` at any ref.
9. **Publish.** `gh release edit X.Y.Z --draft=false --latest`, then it confirms the release is public and GitHub's latest release.
10. **Push the branch.** `git push origin <release commit>:refs/heads/<default branch>`, no force. Later local commits stay local, and nothing is pushed when `origin` already holds the commit. From this moment Obsidian reads the new version.
11. **Summary.** The release URL, the workflow run URL and the branch.

### Every stop, and what to do

Every stop of the push flow, from the `gh` check on, prints where it stopped, what is on `origin`, and the command to resume. Ctrl+C does the same and exits 130. The steps check what is already done, so resuming is safe from any of them.

| Stopped at | State | What to do |
|---|---|---|
| Preflight, `gh` check | Nothing was pushed or changed | Fix the printed problem and rerun |
| The check, after the bump | Files restored, nothing committed | Fix and rerun `opdk release <bump>` |
| Pushing the tag | The tag was not pushed (after Ctrl+C it may have arrived: check with `git ls-remote --tags origin X.Y.Z`) | `opdk release publish X.Y.Z` |
| No workflow run within 3 minutes | The tag is on `origin` | Make the plugin's tag workflow call the kit's `release.yml`, enable Actions, then `opdk release publish X.Y.Z`. The tag is not pushed twice |
| The workflow failed, was cancelled, or ran past `--timeout` | The tag is on `origin`, the release is at most a draft | Read the run log (the URL is printed). Either release a new patch version, or re-run the failed jobs on GitHub and then `opdk release publish X.Y.Z`. A failed run can leave a draft behind: delete that draft before re-running, because a re-run creates the release again and may fail on the existing one. After a timeout, wait for the run and use `--timeout` |
| The workflow succeeded and there is no release | Tag on `origin` | Read the run log, fix the cause and release a new patch version |
| The draft does not match (assets, notes, bytes, attestations) | Nothing was published | Do not edit the assets. Delete the draft, fix the cause (a Node or dependency version in CI and a build that is not reproducible are the usual ones) and release a new patch version with `opdk release patch`. The tag stays |
| Two releases for one tag | Nothing was published | Delete the extra draft on GitHub, then `opdk release publish X.Y.Z` |
| The tag on `origin` points elsewhere, or the tag's `manifest.json` has another version | Nothing was published | A new patch version. Tags are never moved or deleted |
| The tag is lightweight | Nothing was pushed | A new patch version. Release tags are annotated |
| Publishing, or marking the release latest | The release is public or a draft | Follow the printed link and fix by hand, then `opdk release publish X.Y.Z` pushes the branch |
| Pushing the branch (origin has newer commits) | The release is already public | Merge `origin`'s commits without rewriting the release commit: `git pull --no-rebase origin <branch>`, then `git push origin <branch>` |
| Pushing the branch (refused by the server) | The release is already public | Pulling will not help. Get the release commit onto the branch the way the rule allows (a pull request, or an account that may bypass the rule). A merge that keeps the tagged commit lets `opdk release publish X.Y.Z` finish without pushing; after a squash merge the tagged commit is not on the branch and `publish` would try to push it again. This stop is chosen when git's error gives the reason "protected branch hook declined", "push declined due to repository rule violations" or "pre-receive hook declined", or GitHub's code `GH006` or `GH013`; anything else rejected gets the pull hint above |

A stop whose own hint says to release a new version prints `opdk release patch` instead of the resume line, because resuming would stop at the same place. A release that is already public never gets "delete the draft": the message says it is public and not to delete it.

## `opdk release publish [X.Y.Z]`

Starts the push flow (steps 5 to 10) from an existing local tag. Use it to resume, or after `--no-push`. Without a version it uses the version in `manifest.json`. It needs the local annotated tag, the tag's commit on the local default branch, and `gh` signed in with write access. It takes `--timeout <minutes>` and `--zip`.

## `opdk release notes [X.Y.Z]`

Prints the body of the `## [X.Y.Z]` section of the CHANGELOG, by default for the version in `manifest.json`. The release workflow uses it for the release notes. Exit 1, with a message, when the section is missing or empty.

## The reusable workflow

`.github/workflows/release.yml` in this repository is a `workflow_call` workflow. A plugin calls it from a tiny workflow of its own (Quick start) and passes inputs with `with:`:

| Input | Type | Default | What it does |
|---|---|---|---|
| `node-version` | string | `"22"` | Node.js version for `npm ci` and the build |
| `zip` | boolean | `false` | Also attach `<plugin id>-<version>.zip` (`main.js`, `manifest.json`, `styles.css`). Obsidian does not read it. Use `opdk release --zip` together with it |
| `runs-on` | string | `ubuntu-24.04` | Runner label for both jobs. Pinned, not `ubuntu-latest`; see [ci.md](ci.md#why-ubuntu-2404) |

Two jobs:

- **`build`**, with `contents: read` only. It checks out the full history, runs everything that executes plugin code (`npm ci` with no npm cache, `opdk release check --tag`, the build script) and hands `main.js`, `manifest.json`, `styles.css` when present, and the release notes over as a workflow artifact.
- **`release`**, with `contents: write`, `id-token: write` and `attestations: write`. It runs no checkout, no npm and no plugin code. It checks that the artifact holds only the expected files, attests `main.js`, `manifest.json` and `styles.css` with `actions/attest-build-provenance`, and creates a **draft** release named after the tag with the CHANGELOG section as notes. It never publishes.

What it refuses:

- A run that is not for a pushed tag.
- A tag that is not the `manifest.json` version.
- A tag whose commit is not on top of `origin/<default branch>`. The branch is pushed after the release, so the release commit is ahead of it by design; the tip of the default branch must be an ancestor of the tagged commit. A push to the branch after the release commit was made breaks that, and the message says to release again from an up-to-date branch.
- A failing `opdk release check`.
- A plugin whose `package.json` has none of the scripts `build`, `build:plugin`, `compile`, or whose build leaves no `main.js` or `manifest.json`.
- A `<plugin id>` that is not safe in a file name, when `zip` is on.
- A tag that already has a release: this is GitHub's and `gh`'s behaviour when the draft is created, not a check in the workflow.

Every third-party action is pinned to a full commit SHA, with its version in a comment.

**The workflow runs the plugin's build and release check, not its tests.** `opdk release` runs `npm test` on your machine before it creates the release commit, and CI has run the tests of every pushed commit, but the tag workflow itself does not. A plugin that wants the tag to wait for a green test run adds its own job and makes the kit's job depend on it:

```yaml
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
  release:
    needs: test
    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@<full commit SHA of the kit>
```

The `permissions:` block of the caller stays as in the Quick start. `opdk release` finds the kit's run by the workflows it references, so the extra job does not confuse it; the 3-minute wait for a run to start then includes the time the tests take.

**Call it, do not copy it.** The attestations are signed by this workflow, and `opdk release` verifies that the signer identity is the kit's `release.yml`. A copy in the plugin's repository is signed as the plugin's file, so the release stops before it is published. The same goes for pinning: use a full commit SHA of the kit so a moved tag cannot change what runs with your `contents: write` token.

## Configuration

`opdk.config.mjs`, section `release`, all optional:

| Key | Type | Default | What it does |
|---|---|---|---|
| `changelog` | string | `CHANGELOG.md` | The changelog file, a path inside the plugin folder (no absolute path, no `..`) |
| `defaultBranch` | string | from `origin/HEAD` | The branch releases are cut from and pushed to |

```js
import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    release: { defaultBranch: "master" },
});
```

The `build` section applies too: the checks and the verification build with the same entry, output and CSS settings as `opdk build`.

## Flags

| Flag | Applies to | What it does |
|---|---|---|
| `--tag <name>` | `check` | Compare the tag with the version. Defaults to `GITHUB_REF_NAME` when `GITHUB_REF_TYPE=tag` |
| `--no-build` | `check`, `<bump>` | Skip `build`, `assets` and `reproducible` |
| `--no-reproducible` | `check`, `<bump>` | Build once |
| `--no-api` | `check`, `<bump>` | Skip the API check |
| `--no-test` | `<bump>` | Do not run the plugin's `npm test` before the bump |
| `--dry-run` | `<bump>` | Run everything but the commit, the tag and the pushes; print the diff; restore the files. Never calls `gh`; does fetch from and `ls-remote` `origin` |
| `--no-push` | `<bump>` | Stop at the local tag. Continue later with `opdk release publish` |
| `--timeout <minutes>` | `<bump>`, `publish` | How long to wait for the workflow once it started (default 20) |
| `--zip` | `<bump>`, `publish` | Expect `<id>-<version>.zip` among the release assets. The workflow must run with `zip: true` |

`--zip` and `--timeout` cannot be combined with `--no-push`.

`gh` and `git` are run with argument arrays. Only the git commands that talk to the remote (`fetch`, `ls-remote`, `push`) get `GIT_TERMINAL_PROMPT=0` and, unless `GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand` is set, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`; `gh` gets `GH_PROMPT_DISABLED=1`. Nothing waits for a prompt. `OPDK_DEBUG=1` prints a stack for an unexpected error.

## Rollback

A bad release is fixed by a new patch version. `opdk release` never moves or deletes a tag and has no force flag. A public release is not deleted either: if its assets are wrong, release a new version and let Obsidian pick that up from `manifest.json`.

## Example output

A successful run of `opdk release patch`:

```text
· test    npm test (--no-test skips it)
✓ test    npm test passed
· bump    my-plugin: 0.2.1 -> 0.2.2
✓ bump    package.json updated
✓ bump    package-lock.json updated
✓ bump    manifest.json updated
✓ bump    versions.json updated
✓ bump    CHANGELOG.md updated
· check   my-plugin 0.2.2
✓ check   versions: manifest.json, package.json and package-lock.json are all 0.2.2
✓ check   versions.json: 0.2.2 maps to 1.5.0
✓ check   manifest: manifest.json follows the directory's rules
✓ check   changelog: CHANGELOG.md has a section for 0.2.2
✓ check   kit: the kit is v0.1.0 (6e33ca4) in package.json, package-lock.json, 2 workflow lines
✓ check   build: production build of src/main.ts: main.js 0.7 KiB, free of Node-only references
✓ check   assets: main.js, manifest.json, styles.css (built)
✓ check   reproducible: main.js, styles.css identical byte for byte between the working-tree build and a build of the committed tree (HEAD 4e22a12) extracted to another folder
✓ check   api: 1 bundled source file(s) use nothing newer than minAppVersion 1.5.0
✓ check   my-plugin 0.2.2: ready to release.
✓ git     committed "chore(release): 0.2.2" and created the annotated tag 0.2.2
· git     tag 0.2.2 at 44921bb, branch main
✓ gh      you/my-plugin: signed in, admin access
✓ git     pushed the tag 0.2.2 (only the tag; the branch waits for the release)
· wait    Release run 43039645752: in_progress https://github.com/you/my-plugin/actions/runs/43039645752
· wait    Release run 43039645752: queued
· wait    Release run 43039645752: in_progress
· wait    Release run 43039645752: completed (success)
✓ wait    Release succeeded in 1 min
✓ verify  assets: main.js, manifest.json, styles.css
✓ verify  release notes equal the CHANGELOG section of 0.2.2
✓ verify  main.js, manifest.json, styles.css equal a local build of 0.2.2 (44921bb) byte for byte
✓ verify  attestations: main.js, manifest.json, styles.css verified for you/my-plugin at 0.2.2
✓ release  0.2.2 is public and the latest release: https://github.com/you/my-plugin/releases/tag/0.2.2
✓ git     pushed the release commit to main (no force)
✓ release  you/my-plugin 0.2.2 released
· release  release   https://github.com/you/my-plugin/releases/tag/0.2.2
· release  workflow  https://github.com/you/my-plugin/actions/runs/43039645752
· release  branch    main pushed; Obsidian now reads 0.2.2 from its manifest.json
```

### A stop after the release is public

Someone pushed to `main` while the release ran, so `origin` rejects the push of the release commit. The release is already public and the output says how to finish (the git error is printed as git wrote it). When the server refuses the push instead (a branch protection, a repository rule or a server hook), the first line reads `origin refused the push of main (a branch protection, a repository rule or a server hook).` and the hint says to get the release commit onto the branch the way the rule allows, because pulling will not help:

```text
✗ release  0.2.3: origin rejected the push of main: it has commits that are not here. The release 0.2.3 is already public.
            git push origin 44921bb:refs/heads/main failed: To github.com:you/my-plugin.git
 ! [rejected]        44921bb -> main (fetch first)
error: failed to push some refs to 'github.com:you/my-plugin.git'
          Merge them without rewriting the release commit: `git pull --no-rebase origin main`, then `git push origin main`. The manifest on main must reach the version 0.2.3 for Obsidian to offer it.
✗ release  stopped while pushing the branch.
            The release 0.2.3 is public.
            The branch main was not pushed.
          Resume with: opdk release publish 0.2.3
```

## Migrating from a plugin's own release scripts

What the kit replaces is usually the same; what stays is your own.

**The release scripts and workflow:**

- A version-sync script (`scripts/version-sync.cjs`) is replaced by `opdk release <bump>`, which also refuses to rewrite a released `versions.json` entry and checks the lockfile.
- A version assertion script (`scripts/assert-versions.cjs`) is replaced by `opdk release check`. If the script never compared the tag with the manifest, the workflow now does.
- A zip script (`scripts/make-zip.cjs`) goes away, and so does a release audit script (`scripts/release-audit.cjs`). No release ships a zip by default, so there is nothing to audit; the draft is verified against a build of the tag instead, and `--zip` exists if you want a zip. If you had added an attestation after a scorecard flagged its absence, it is now made, and verified, by the flow.
- `.github/workflows/release.yml` becomes the short caller from Quick start.
- `scripts.build` has to run `opdk build`.
- What changes: the release is created as a draft and published by `opdk release` after verification, its body is the CHANGELOG section instead of GitHub's list of pull requests, the workflow no longer runs `npm run test` (a release workflow that ran only that and `npm run build` loses the test run; run tests, lint and typecheck in branch CI and in your own `release:check` script before you cut the release), and the branch is pushed after the release instead of with the tag. The tag is annotated, which is new if your tags were lightweight. The release commit still goes straight to the default branch, so a protection rule that blocks that push ends the flow at its last step (see the table of stops).
- If you keep your own schema version policy or an "instructions review" gate, run them before `opdk release`, because the release needs a clean tree. If generated files name the plugin version and your CI checks them in sync (`build:skill -- --check`), the release commit holds only the version files, so after `opdk release` regenerate them and commit the result, or CI fails. A GitHub Pages workflow on the same tag keeps working; the release wait ignores it.

**In `ci.yml` and `package.json`** (if your `ci.yml` runs `node scripts/assert-versions.cjs`, `npm run release:zip` and uploads `<plugin>-*.zip` with the bundle):

- Replace the `node scripts/assert-versions.cjs` step with `npx opdk release check --no-build --no-api`. Branch CI already installs and runs `npm run build` as a step of its own, so `--no-build` skips the build, asset and reproducibility checks, which would build twice more, and `--no-api` skips the `minAppVersion` check against the Obsidian API, which needs a type-aware lint pass. What stays: the version files agree, `versions.json`, the manifest rules, the CHANGELOG section and the format of the JSON files the release rewrites. The full check (build, assets, reproducibility, API) runs in the release workflow on the tag and in `opdk release <bump>` before anything is committed. Drop both flags to run the full check in branch CI as well, at the price of the two extra builds and the type-aware pass. The kit's reusable [`plugin-ci.yml`](ci.md) runs this step with the flags above, together with lint, typecheck, tests, the scanner and the build.
- Remove the `Pack plugin zip` step (`npm run release:zip`) and the `<plugin>-*.zip` line from the artifact `path:` list.
- In `package.json`, rewrite `release:check` by replacing `node scripts/version-sync.cjs` with `opdk release check` (it builds, so a trailing `npm run build` is redundant), and remove `release:zip`, `release` and `release:audit` if you have them. `release:check` keeps your own steps (scorecard and tests, and lint and typecheck if it ran them).

**If the plugin has no `versions.json`:**

- Create `versions.json` before the first `opdk release check`, in the format the kit writes (two-space indent, final newline), not on one line:

  ```json
  {
    "1.7.1": "1.5.0"
  }
  ```

  `opdk release <bump>` also creates a missing file, but `check` fails without it. `check` also fails on a one-line file, because the release rewrites it and refuses a file it cannot write back as it is. Prettier keeps a one-entry object on one line, so use the `node -e` command in the hint of that error (it writes LF line endings, so a CRLF file that is misformatted for another reason becomes LF).

**Existing tags:** legacy tags such as `v0.x` stay as they are. The kit looks for the exact tag it is releasing and never lists or touches other tags.
