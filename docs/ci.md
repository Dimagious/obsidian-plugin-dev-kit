# Continuous integration

`.github/workflows/plugin-ci.yml` is a reusable GitHub Actions workflow that checks an Obsidian plugin on every push and pull request: lint, typecheck, unit tests, the community scanner, the release check and the build, then it uploads the bundle. A plugin calls it from a few lines of its own `ci.yml`. Steps that belong to one plugin stay in that plugin, in a second job.

## Why

Snipsy, Dashy and Garmy each had a `ci.yml` of about 50 lines: the same steps in a different order, on `ubuntu-latest`, with actions pinned to a major tag. They had drifted. Snipsy has a lint script that its CI never ran, and each plugin carried its own version check. The workflow keeps the common part in one place, pinned the way `release.yml` is, with a read-only token.

## Quick start

Add a workflow that calls the kit's, pinned to a full commit SHA, not to a branch or a tag name:

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
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

Every step is one command; the job stops at the first failure.

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

The workflow sets `permissions: {}` at the top and gives its one job `contents: read`. No step can push, create a release or sign. The caller has to grant at least `contents: read` (a called workflow cannot ask for more than its caller allows). Every action is pinned to a full commit SHA with the version in a comment, and no `${{ }}` expression appears inside a `run:` script: values reach scripts through `env`. A test in the kit (`src/ci/plugin-ci-workflow.test.ts`) fails when one of these breaks.

The npm cache is restored here because the job holds no token that can write to the repository; `release.yml` turns it off because its release job does.

## Why ubuntu-24.04

On 2026-11-11 the `ubuntu-latest` image (26.04) could not resolve the Ubuntu archive, and a CI job in the kit hung on `apt-get` until it timed out. Move to the next LTS on purpose, by passing `runs-on`, not by an alias that changes under you. The plugin's second job should pin the same label.

## Keeping plugin-specific steps

Put them in a second job of the caller. The two jobs run in parallel; add `needs: kit` to a job that should wait. Examples that stay in plugins: Dashy's `build:skill -- --check`, `build:reference -- --check` and `site:check`; `readme:check` in Dashy and Garmy; Snipsy's `site:check` and Codecov upload.

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
      - uses: actions/download-artifact@<full commit SHA>
        with:
          name: snipsidian-coverage
      - uses: codecov/codecov-action@<full commit SHA>
        with:
          files: ./lcov.info
```

## Migrating a plugin

Checked against the `ci.yml` of each plugin on 2026-11-11. The step names are the plugin's own.

| Plugin | Replaced by the workflow | Stays in the plugin's own job | Changes to expect |
|---|---|---|---|
| Dashy | Install, Lint, Typecheck, Verify versions (`assert-versions.cjs`), Scorecard regression gate (`opdk scan`), Unit tests, Build, Upload plugin bundle | Skill in sync (`build:skill -- --check`), Site block reference in sync (`build:reference -- --check`), Project site (`site:check`), README (`readme:check`) | The zip is no longer built or uploaded (`release:zip`, `dashsidian-*.zip`); the release workflow makes one only on request. The release check is stricter than `assert-versions.cjs` (CHANGELOG section, `versions.json`, manifest rules) |
| Garmy | Install, Lint, Typecheck, Versions agree (`assert-versions.cjs`), Scorecard regression gate, Unit tests, Build, Upload bundle | README (`readme:check`) | Same as Dashy for the zip and the release check. `garmidian-bundle` keeps its name |
| Snipsy | Install, Typecheck, Verify versions, Scorecard regression gate, Unit tests, Build, Upload plugin bundle | Project site (`site:check`), Codecov upload (needs `coverage-artifact: true`, see above) | Snipsy has a `lint` script that its CI never ran: the workflow runs it, so fix its findings or pass `lint: false`. It has no `typecheck` script, so `tsc --noEmit` runs (the same as `npx tsc -p tsconfig.json --noEmit` while the tsconfig is the default one). The release check needs a `versions.json`, which the plugin does not have yet (see the release docs). The separate coverage artifact becomes `snipsidian-coverage` |

For all three: the runner moves from `ubuntu-latest` to `ubuntu-24.04`; actions move from major tags to pinned SHAs; the bundle artifact keeps the name `<id>-bundle`. The plugin's `release:check` and `release:zip` npm scripts are not used by this workflow.
