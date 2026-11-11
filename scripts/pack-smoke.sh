#!/usr/bin/env bash
# Packs the kit, installs the tarball into a fresh project and runs the CLI the way a plugin would.
# A broken `prepare` or a missing file in the tarball breaks every plugin install, so CI runs this.
set -euo pipefail
# A hook or worktree session may export these; they would point every git call below at the wrong repository.
# `${!GIT_@}` expands to nothing when none is set, so `set -u` stays quiet.
for name in ${!GIT_@}; do unset "$name"; done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root"
# Build explicitly so build errors surface here, before `npm pack` runs its own `prepare`.
npm run build --silent
expected_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version")"
tarball="$(npm pack --loglevel=error --pack-destination "$tmp" | tail -n 1)"

# The peer dependencies a plugin brings itself, at the versions the kit is developed against, so the smoke runs
# `opdk scan` on the ESLint the plugins run.
eslint_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).devDependencies.eslint")"
typescript_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).devDependencies.typescript")"
# The version of Playwright the e2e step below installs.
playwright_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).devDependencies['@playwright/test']")"

# The agent skills ship in the tarball at the same path as in the repository.
tarball_files="$(tar -tzf "$tmp/$tarball")"
for skill_file in plugins/opdk/skills/*/SKILL.md; do
    if ! grep -qx "package/$skill_file" <<<"$tarball_files"; then
        echo "smoke: the tarball has no $skill_file" >&2
        exit 1
    fi
done

mkdir "$tmp/project"
cd "$tmp/project"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "eslint@$eslint_version" "typescript@$typescript_version"
npm install --no-audit --no-fund --loglevel=error "$tmp/$tarball"

# Playwright and Electron are optional peers: installing the kit must not bring them. Everything up to the e2e step
# below runs without them, which is the proof that the CLI, the build and the scanner never load Playwright.
for optional_peer in node_modules/@playwright/test node_modules/electron; do
    if [ -e "$optional_peer" ]; then
        echo "smoke: $optional_peer exists before the e2e step; the kit's optional peers must not be installed with it" >&2
        exit 1
    fi
done

echo "--- npx opdk --help"
npx --no -- opdk --help

echo "--- npx opdk --version"
actual_version="$(npx --no -- opdk --version)"
echo "$actual_version"
# The version, plus the short git commit the build embedded when the kit was built inside a checkout. In a checkout
# the commit is required (a missing one means build-info broke); `-dirty` is allowed for uncommitted changes.
if kit_commit="$(git -C "$root" rev-parse --short HEAD 2>/dev/null)" && [ -n "$kit_commit" ]; then
    if [[ ! "$actual_version" =~ ^"$expected_version"\ \("$kit_commit"(-dirty)?\)$ ]]; then
        echo "smoke: opdk --version printed '$actual_version', expected '$expected_version ($kit_commit)', optionally with -dirty after the commit" >&2
        exit 1
    fi
elif [ "$actual_version" != "$expected_version" ]; then
    echo "smoke: opdk --version printed '$actual_version', expected '$expected_version' (the kit is not in a git checkout)" >&2
    exit 1
fi

echo "--- npx opdk --version with a broken manifest.json in the current folder"
# The scan loads eslint-plugin-obsidianmd, which reads manifest.json when it is imported; no other command may.
printf '{bad json' > manifest.json
broken_output="$(npx --no -- opdk --version 2>&1)"
if [ "$broken_output" != "$actual_version" ]; then
    echo "smoke: opdk --version with a broken manifest.json printed '$broken_output', expected only '$actual_version'" >&2
    exit 1
fi

echo "--- npx opdk build (tiny fixture plugin)"
mkdir -p src/styles
cat > manifest.json <<'JSON'
{ "id": "smoke-plugin", "name": "Smoke", "version": "1.0.0", "isDesktopOnly": false }
JSON
printf 'import { Plugin } from "obsidian";\nexport default class SmokePlugin extends Plugin {}\n' > src/main.ts
printf '@import "./base.css";\n' > src/styles/main.css
printf '.smoke { color: red; }\n' > src/styles/base.css
# Keep the output on failure too: set -e would otherwise exit before the esbuild error is printed.
build_status=0
build_output="$(env -u FORCE_COLOR -u NO_COLOR -u GITHUB_ACTIONS npx --no -- opdk build 2>&1)" || build_status=$?
printf '%s\n' "$build_output"
if [ "$build_status" -ne 0 ]; then
    echo "smoke: opdk build exited with $build_status" >&2
    exit 1
fi
# Captured through a pipe with the colour variables unset (CI sets GITHUB_ACTIONS), so the reporter must stay
# plain: symbols yes, escape codes no.
if printf '%s' "$build_output" | grep -q $'\x1b'; then
    echo "smoke: opdk build wrote escape codes into a pipe" >&2
    exit 1
fi
if ! printf '%s' "$build_output" | grep -q '✓'; then
    echo "smoke: opdk build output has no ✓ line" >&2
    exit 1
fi
# FORCE_COLOR must switch the paint path on without a terminal.
forced_output="$(env -u NO_COLOR FORCE_COLOR=1 npx --no -- opdk build 2>&1)"
if ! printf '%s' "$forced_output" | grep -q $'\x1b'; then
    echo "smoke: FORCE_COLOR=1 opdk build wrote no escape codes" >&2
    exit 1
fi
for artefact in main.js styles.css; do
    if [ ! -s "$artefact" ]; then
        echo "smoke: opdk build did not produce $artefact" >&2
        exit 1
    fi
done
# The CSS step must inline the import, obsidian must stay external, and the cjs footer must be there.
if grep -q '@import' styles.css || ! grep -q '\.smoke' styles.css; then
    echo "smoke: styles.css does not hold the inlined .smoke rule" >&2
    exit 1
fi
if ! grep -q 'require("obsidian")' main.js; then
    echo "smoke: main.js does not keep obsidian external" >&2
    exit 1
fi
if ! grep -q 'module.exports = module.exports.default || module.exports;' main.js; then
    echo "smoke: main.js is missing the module.exports footer" >&2
    exit 1
fi

echo "--- npx opdk scan (same fixture, as a git repository)"
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "target": "ES2020", "lib": ["ES2020", "DOM"], "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "noEmit": true, "types": [] }, "include": ["src/**/*.ts"] }
JSON
printf 'node_modules/\nmain.js\nstyles.css\npackage-lock.json\n' > .gitignore
# The fixture's main.ts is the one `opdk build` compiled above; scan reads only the files git tracks.
git init -q
git add -A
scan_status=0
scan_output="$(env -u FORCE_COLOR -u NO_COLOR -u GITHUB_ACTIONS npx --no -- opdk scan 2>&1)" || scan_status=$?
printf '%s\n' "$scan_output"
if [ "$scan_status" -ne 0 ]; then
    echo "smoke: opdk scan exited with $scan_status on a clean fixture" >&2
    exit 1
fi
if ! printf '%s' "$scan_output" | grep -q '✓ scan'; then
    echo "smoke: opdk scan output has no ✓ scan line" >&2
    exit 1
fi
printf 'export const wait = (): void => {\n    setTimeout(() => undefined, 1);\n};\n' > src/late.ts
git add -A
bad_status=0
bad_output="$(env -u FORCE_COLOR -u NO_COLOR -u GITHUB_ACTIONS npx --no -- opdk scan 2>&1)" || bad_status=$?
printf '%s\n' "$bad_output"
if [ "$bad_status" -ne 1 ]; then
    echo "smoke: opdk scan exited with $bad_status on a fixture with a finding, expected 1" >&2
    exit 1
fi
if ! printf '%s' "$bad_output" | grep -q 'src/late.ts:2  obsidianmd/prefer-window-timers'; then
    echo "smoke: opdk scan did not report src/late.ts:2 obsidianmd/prefer-window-timers" >&2
    exit 1
fi
rm src/late.ts
git add -A

echo "--- npx opdk release check (the fixture is no releasable plugin: it must fail, and the build step must still run)"
release_status=0
release_output="$(env -u FORCE_COLOR -u NO_COLOR -u GITHUB_ACTIONS npx --no -- opdk release check --no-api 2>&1)" || release_status=$?
printf '%s\n' "$release_output"
if [ "$release_status" -ne 1 ] || ! printf '%s' "$release_output" | grep -q 'versions.json is missing' || ! printf '%s' "$release_output" | grep -q 'production build of'; then
    echo "smoke: opdk release check exited with $release_status, expected 1, 'versions.json is missing' and a passing build line" >&2
    exit 1
fi

echo "--- npx opdk demo (no films recorded; Playwright and Electron are not installed, and the command must not need them)"
demo_status=0
demo_output="$(env -u FORCE_COLOR -u NO_COLOR -u GITHUB_ACTIONS npx --no -- opdk demo 2>&1)" || demo_status=$?
printf '%s\n' "$demo_output"
if [ "$demo_status" -ne 1 ] || ! printf '%s' "$demo_output" | grep -q 'no films in'; then
    echo "smoke: opdk demo exited with $demo_status, expected 1 and a 'no films in' message" >&2
    exit 1
fi

echo "--- import obsidian-plugin-dev-kit"
node --input-type=module -e "
import { defineConfig } from 'obsidian-plugin-dev-kit';
if (typeof defineConfig !== 'function') throw new Error('defineConfig is not exported');
"

echo "--- import obsidian-plugin-dev-kit/eslint"
node --input-type=module -e "
import { obsidianPlugin } from 'obsidian-plugin-dev-kit/eslint';
const config = obsidianPlugin({ rootDir: process.cwd() });
if (!Array.isArray(config) || config.length === 0) throw new Error('obsidianPlugin() returned no config');
"

echo "--- import obsidian-plugin-dev-kit/e2e (Playwright installed only now: nothing above needed it)"
# The e2e subpath is the only part of the kit that loads Playwright. Playwright is an optional peer, so a plugin
# that uses e2e installs it itself; the version here is the one the kit is developed against.
npm install --no-audit --no-fund --loglevel=error "@playwright/test@$playwright_version"
node --input-type=module -e "
import { createObsidianTest, defineObsidianConfig } from 'obsidian-plugin-dev-kit/e2e';
const kit = createObsidianTest({ seedVault: 'e2e/vault' });
if (typeof kit.test !== 'function' || typeof kit.expect !== 'function' || typeof kit.onlyWhen !== 'function') {
    throw new Error('createObsidianTest did not return { test, expect, onlyWhen }');
}
let rejected = false;
try { createObsidianTest({}); } catch (error) { rejected = /seedVault/.test(String(error)); }
if (!rejected) throw new Error('createObsidianTest accepted options without seedVault');
if (defineObsidianConfig().workers !== 1) throw new Error('defineObsidianConfig did not set workers: 1');
"

echo "smoke: ok"
