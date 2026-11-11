#!/usr/bin/env bash
# Re-records docs/media/demo.gif with the kit's own demo module: the gated docs-film spec records a phone film in a
# real Obsidian (a temp vault copy and user-data folder; never the owner's vaults), then `opdk demo` composes it with
# the captions and encodes the GIF. Settings are in opdk.config.mjs. Needs Obsidian, ffmpeg and a built dist/.
set -euo pipefail

CDPATH= cd -- "$(dirname "$0")/.."
if ! command -v ffmpeg >/dev/null 2>&1 && [ -z "${OPDK_FFMPEG:-}" ]; then
    echo "[docs:media:demo] ffmpeg is not installed or not on PATH. Install it (for example 'brew install ffmpeg') and run again." >&2
    exit 1
fi
if [ ! -d dist/demo ]; then
    echo "[docs:media:demo] dist/ is missing. Run 'npm run build' first." >&2
    exit 1
fi
# VAULT_PLUGIN is the dev-vault variable of `opdk build --vault`; nothing here may see it.
unset VAULT_PLUGIN

rm -rf .opdk/demo
OPDK_E2E_DOCS_FILM=1 node_modules/.bin/playwright test -c test/e2e-fixture/playwright.config.ts docs-film.spec.ts
node bin/opdk.js demo demo
rm -rf test-results playwright-report
echo "[docs:media:demo] wrote docs/media/demo.gif ($(du -k docs/media/demo.gif | cut -f1) KiB)"
