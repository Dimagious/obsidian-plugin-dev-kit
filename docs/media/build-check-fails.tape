# Regenerate with `npm run build && npm run docs:media` from the kit root.
# A plugin that reads process.env: `opdk build` finishes the bundle, then the check fails the build.
Output docs/media/build-check-fails.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 330
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
Type "mkdir -p src/styles" Enter
Type `printf '{"id":"hello-plugin","name":"Hello","version":"1.0.0","isDesktopOnly":false}\n' > manifest.json` Enter
Type `printf 'import { Plugin } from "obsidian";\nexport default class HelloPlugin extends Plugin {\n    home = process.env.HOME;\n}\n' > src/main.ts` Enter
Type `printf '.hello { color: tomato; }\n' > src/styles/main.css` Enter
Type "clear" Enter
Show

Sleep 500ms
Type "opdk build" Enter
Sleep 4s
Type 'echo "exit code: $?"' Enter
Sleep 3s

Hide
Type `cd / && rm -rf "${D:?}"` Enter
