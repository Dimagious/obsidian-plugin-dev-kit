# Regenerate with `npm run build && npm run docs:media` from the kit root.
# Dashy's 1.1.6 regression: a host assembled from joined strings, plus a bare timer, an !important and a
# description that starts with the plugin name. Every check fails; the exit code is 1.
Output docs/media/scan-fails.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 620
Set Padding 16
Set Margin 24
Set MarginFill "#8e9bb0"
Set BorderRadius 8
Set WindowBar Colorful
Set Theme "GitHub Dark"
Set TypingSpeed 70ms

Hide
Type `export PS1='$ '; R=$PWD; opdk() { node "$R/bin/opdk.js" "$@"; }; unset VAULT_PLUGIN` Enter
Type `D="$(mktemp -d)" && cd "$D" || exit 1` Enter
Type "mkdir -p src" Enter
Type `printf '{"id":"hello-plugin","name":"Hello","version":"1.0.0","description":"Hello is a demo plugin.","isDesktopOnly":false}\n' > manifest.json` Enter
Type `printf '{"compilerOptions":{"target":"ES2020","lib":["ES2020","DOM"],"module":"ESNext","moduleResolution":"Bundler","strict":true,"noEmit":true,"types":[]},"include":["src/**/*.ts"]}\n' > tsconfig.json` Enter
Type `printf 'export const forum = ["forum", "obsidian", "md"].join(".");\nexport function later(): void {\n    setTimeout(() => undefined, 100);\n}\n' > src/main.ts` Enter
Type `printf '.hello { color: tomato !important; }\n' > styles.css` Enter
Type "git init -q && git add -A" Enter
# `Wait+Screen` only sees the top of the terminal, so clear it once the setup commands ran, then wait for the marker
# (the typed line has a quote the output lacks).
Type `clear; echo RE""ADY` Enter
Wait+Screen@120s /READY/
Type "clear" Enter
Sleep 1s
Show

Sleep 500ms
Type "opdk scan" Enter
Wait+Screen@60s /Each line reads/
Sleep 1s
Type 'echo "exit code: $?"' Enter
Sleep 3s

Hide
Type `cd / && rm -rf "${D:?}"` Enter
