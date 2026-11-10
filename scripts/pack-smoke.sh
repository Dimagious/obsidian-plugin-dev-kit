#!/usr/bin/env bash
# Packs the kit, installs the tarball into a fresh project and runs the CLI the way a plugin would.
# A broken `prepare` or a missing file in the tarball breaks every plugin install, so CI runs this.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root"
# Build explicitly so build errors surface here, before `npm pack` runs its own `prepare`.
npm run build --silent
expected_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version")"
tarball="$(npm pack --loglevel=error --pack-destination "$tmp" | tail -n 1)"

mkdir "$tmp/project"
cd "$tmp/project"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$tmp/$tarball"

echo "--- npx opdk --help"
npx --no -- opdk --help

echo "--- npx opdk --version"
actual_version="$(npx --no -- opdk --version)"
echo "$actual_version"
if [ "$actual_version" != "$expected_version" ]; then
    echo "smoke: opdk --version printed '$actual_version', expected '$expected_version'" >&2
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

echo "--- import obsidian-plugin-dev-kit"
node --input-type=module -e "
import { defineConfig } from 'obsidian-plugin-dev-kit';
if (typeof defineConfig !== 'function') throw new Error('defineConfig is not exported');
"

echo "smoke: ok"
