# Regenerate with `npm run build && npm run docs:media` from the kit root.
# Runs the real `opdk scan` on a throwaway plugin (a git repository in a temp dir) that passes every check.
Output docs/media/scan.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 340
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
Type `printf '{"id":"hello-plugin","name":"Hello","version":"1.0.0","description":"Greets people in the status bar.","isDesktopOnly":false}\n' > manifest.json` Enter
Type `printf '{"compilerOptions":{"target":"ES2020","lib":["ES2020","DOM"],"module":"ESNext","moduleResolution":"Bundler","strict":true,"noEmit":true,"types":[]},"include":["src/**/*.ts"]}\n' > tsconfig.json` Enter
Type `printf 'export function later(): void {\n    window.setTimeout(() => undefined, 100);\n}\n' > src/main.ts` Enter
Type `printf '.hello { color: tomato; }\n' > styles.css` Enter
Type "git init -q && git add -A" Enter
Type "clear" Enter
Show

Sleep 500ms
Type "opdk scan" Enter
Sleep 12s
Type 'echo "exit code: $?"' Enter
Sleep 3s

Hide
Type `cd / && rm -rf "${D:?}"` Enter
