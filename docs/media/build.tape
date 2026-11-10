# Regenerate with `npm run build && npm run docs:media` from the kit root.
# Runs the real `opdk build` on a throwaway plugin in a temp dir.
Output docs/media/build.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 300
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
Type `printf 'import { Plugin } from "obsidian";\nexport default class HelloPlugin extends Plugin {}\n' > src/main.ts` Enter
Type `printf '@import "./base.css";\n.hello { color: tomato; }\n' > src/styles/main.css` Enter
Type `printf '.base { margin: 0; }\n' > src/styles/base.css` Enter
Type "clear" Enter
Show

Sleep 500ms
Type "opdk build" Enter
Wait+Screen /Node-only references/
Type "ls main.js styles.css" Enter
Sleep 3s

Hide
Type `cd / && rm -rf "${D:?}"` Enter
