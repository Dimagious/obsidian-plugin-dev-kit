# Continuous integration

`.github/workflows/plugin-ci.yml` is a reusable GitHub Actions workflow that checks an Obsidian plugin on every push and pull request: lint, typecheck, unit tests, the community scanner, the release check and the build, then it uploads the bundle. A plugin calls it from a few lines of its own `ci.yml`. The workflow is for Linux runners (its scripts run with bash). Steps that belong to one plugin stay in that plugin, in a second job.

## Why

Three plugins each kept a hand-written `ci.yml` of 45 to 75 lines, and they had drifted: the same steps in a different order, on `ubuntu-latest`, with actions pinned to a major tag. One plugin had a lint script that its CI never ran, and each carried its own version check. The workflow keeps the common part in one place, pinned the way `release.yml` is, with a read-only token.

## Quick start

Add a workflow that calls the kit's, pinned to a full commit SHA, not to a branch or a tag name:

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]   # use your default branch name
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  kit:
    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/plugin-ci.yml@<full commit SHA of the kit>

  # Optional: whatever only this plugin checks. Runs in parallel with the job above.
  plugin:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<full commit SHA>
        with:
          persist-credentials: false
      - run: node scripts/site-check.cjs
```

The plugin needs `obsidian-plugin-dev-kit` as a dev dependency (the workflow runs `node_modules/.bin/opdk`), a `package-lock.json` (it runs `npm ci`) and a `manifest.json` at the root. Concurrency stays in the caller: a reusable workflow cannot cancel the caller's runs.

## Inputs

All inputs are optional.

| Input | Type | Default | Meaning |
|---|---|---|---|
| `node-version` | string | `"22"` | Node.js version for every step |
| `runs-on` | string | `ubuntu-24.04` | Runner label (see "Why ubuntu-24.04") |
| `lint` | boolean | `true` | `npm run lint`. Skipped with a notice when `package.json` has no `lint` script |
| `typecheck` | boolean | `true` | `npm run typecheck`, or `node_modules/.bin/tsc --noEmit` when there is no such script. Fails when neither exists |
| `test` | boolean | `true` | `npm run test` |
| `scan` | boolean | `true` | `node_modules/.bin/opdk scan` |
| `release-check` | boolean | `true` | `node_modules/.bin/opdk release check --no-build --no-api` |
| `build` | boolean | `true` | `npm run build` |
| `upload-bundle` | boolean | `true` | Upload `main.js`, `manifest.json` and `styles.css` (when it exists) as the artifact `<plugin id>-bundle`. A missing or empty `main.js` or `manifest.json` fails the job |
| `coverage-artifact` | boolean | `false` | Upload `coverage/**` as the artifact `<plugin id>-coverage`. Fails when the folder is empty or missing |

No input takes a command. A caller cannot make the workflow run a string it passed in; a different command for a step is the plugin's own script (`npm run lint` runs whatever `scripts.lint` says), or a step in the plugin's second job. `upload-bundle` needs the `build` step in this job: `build: false` with `upload-bundle: true` fails unless the repository commits its `main.js`.

## What each step runs

Every step is one command. The job stops at the first failure.

1. `actions/checkout` with `persist-credentials: false`, then `actions/setup-node` with the npm cache.
2. Read the plugin id from `manifest.json` (the artifact names use it; an id that is not safe in a file name stops the job).
3. `npm ci`.
4. Lint, typecheck, unit tests (the three switches above).
5. `opdk scan`: the community scanner's checks, see [scanner.md](scanner.md).
6. `opdk release check --no-build --no-api`: versions in `package.json`, `manifest.json`, `package-lock.json` and `versions.json`, the manifest rules, a CHANGELOG section for the current version. The build, reproducibility and API checks are left out: the build step builds once, and the full check runs on the tag in `release.yml`. See [release.md](release.md).
7. `npm run build`.
8. The bundle check and the artifact uploads.

The plugin's `build` script should run `opdk build`, as the release module requires.

## Permissions

The workflow sets `permissions: {}` at the top and gives its one job `contents: read`. No step can push, create a release or sign. The caller has to grant at least `contents: read` (a called workflow cannot ask for more than its caller allows). Every action is pinned to a full commit SHA with the version in a comment. No `${{ }}` expression appears inside a `run:` script, and no caller value reaches a script: the plugin id is read from `manifest.json` inside the step. A test in the kit (`src/ci/plugin-ci-workflow.test.ts`) fails when one of these breaks, including a pinned action that lost its version comment.

The npm cache is on in this workflow. Any job can write the Actions cache whatever its `permissions` say, so the read-only token is not the reason. The reasons are that nothing this job builds is shipped, and that npm checks cached tarballs against the hashes in `package-lock.json`. `release.yml`, whose build is attested and shipped, restores no cache. For the same reason, do not enable the npm cache in your own release or other privileged workflows.

## Why ubuntu-24.04

On 2026-11-11 the `ubuntu-latest` image (26.04) could not resolve the Ubuntu archive, and a CI job in the kit hung on `apt-get` until it timed out. Move to the next LTS on purpose, by passing `runs-on`, not by an alias that changes under you. The plugin's second job should pin the same label. The reusable `release.yml` takes the same `runs-on` input, with the same default.

## Keeping plugin-specific steps

Put them in a second job of the caller. The two jobs run in parallel; add `needs: kit` to a job that should wait. Examples that stay in plugins: checks that generated files are in sync (`build:skill -- --check`), a project site check (`site:check`), a README check (`readme:check`) and a Codecov upload.

For coverage services, ask for the report and download it in the second job:

```yaml
jobs:
  kit:
    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/plugin-ci.yml@<full commit SHA of the kit>
    with:
      coverage-artifact: true
  coverage:
    needs: kit
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: <plugin id>-coverage
      - uses: codecov/codecov-action@<full commit SHA> # v<version>
        with:
          files: ./lcov.info
          fail_ci_if_error: true
```

## Migrating a plugin

Compare your current `ci.yml` with the workflow, step by step:

- **Replaced by the workflow.** Install, lint, typecheck, a version check (`assert-versions`-style scripts), a scorecard gate (`opdk scan`), unit tests, the build and the bundle upload. Delete them from your `ci.yml` and call the workflow.
- **Stays in your own job.** Steps that belong to one plugin: generated files in sync, a project site build, README checks, a coverage service upload (needs `coverage-artifact: true`, see above).
- **A zip is no longer built or uploaded.** If your CI ran a `release:zip` script and uploaded `<plugin>-*.zip`, drop both; the release workflow makes a zip only on request.
- **The release check is stricter than a hand-written version script.** It also wants a CHANGELOG section, the manifest rules and the versions in `package-lock.json`, and it needs a `versions.json` (see the release docs).
- **A lint script your CI never ran now runs.** Fix its findings, or pass `lint: false` until you do.
- **No `typecheck` script.** The workflow runs `tsc --noEmit` (the same as `npx tsc -p tsconfig.json --noEmit` while the tsconfig is the default one).
- **A default branch that is not `main`.** Use its name in `branches` in the caller.
- **The separate coverage artifact** is named `<plugin id>-coverage`.

The runner moves from `ubuntu-latest` to `ubuntu-24.04`; actions move from major tags to pinned SHAs; the bundle artifact keeps the name `<id>-bundle`. The plugin's `release:check` and `release:zip` npm scripts are not used by this workflow.
