#!/usr/bin/env bash
# Re-records docs/media/e2e.gif: runs the gated media spec against a real Obsidian (a temp vault and user-data
# folder; never the owner's vaults), then turns the .webm into a GIF with ffmpeg. Needs Obsidian and ffmpeg.
set -euo pipefail

CDPATH= cd -- "$(dirname "$0")/.."
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[docs:media:e2e] ffmpeg is not installed or not on PATH. Install it (for example 'brew install ffmpeg') and run again." >&2
    exit 1
fi
# VAULT_PLUGIN is the dev-vault variable of `opdk build --vault`; nothing here may see it.
unset VAULT_PLUGIN

# The recording starts while Obsidian is still loading; the GIF starts where the workspace is on screen.
TRIM_START="${E2E_GIF_TRIM_START:-1.4}"
OUT="docs/media/e2e.gif"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/opdk-gif.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PALETTE="$WORK/palette.png"

rm -rf test-results
OPDK_E2E_MEDIA=1 node_modules/.bin/playwright test -c test/e2e-fixture/playwright.config.ts media.spec.ts
VIDEO="$(find test-results -name '*.webm' -print -quit 2>/dev/null || true)"
if [ -z "$VIDEO" ]; then
    echo "[docs:media:e2e] no .webm in test-results/. The media spec did not record; run it by hand and read its output." >&2
    exit 1
fi

FILTERS="fps=10,scale=800:-1:flags=lanczos"
ffmpeg -v error -y -ss "$TRIM_START" -i "$VIDEO" -vf "$FILTERS,palettegen=max_colors=128" "$PALETTE"
ffmpeg -v error -y -ss "$TRIM_START" -i "$VIDEO" -i "$PALETTE" -lavfi "$FILTERS [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4" "$OUT"
rm -rf test-results playwright-report
echo "[docs:media:e2e] wrote $OUT ($(du -k "$OUT" | cut -f1) KiB)"
