---
paths: ["src/**/*.{ts,mts,cts,js,mjs,cjs}"]
---

# Plugin source and the community scorecard

Each item below is a finding in `opdk scan` and a warning on the plugin's public scorecard. Test files (`*.test.*`, `*.spec.*`) are not scanned. Run `npx opdk scan` before you finish: exit code 1 means a finding.

- `document.x` becomes `activeDocument.x`, so the code works in popout windows (`obsidianmd/prefer-active-doc`).
- Timers go on `window`: `window.setTimeout`, `window.clearTimeout`, `window.setInterval`, `window.clearInterval`, `window.requestAnimationFrame`, `window.cancelAnimationFrame`. Not a bare `setTimeout`, not `activeWindow.setTimeout` (`obsidianmd/prefer-window-timers`).
- Elements come from Obsidian's helpers: `el.createDiv()`, `el.createSpan()`, `el.createEl(tag)`, or the global `createDiv()`/`createSpan()`/`createEl(tag)` for an element with no parent yet. Never `createElement(` on any object, `el.ownerDocument.createElement` included (`obsidianmd/prefer-create-el`, `no-create-element`).
- A URL or host is one string literal. Never build a host with `.join(".")` or `.join("/")` (`no-domain-assembly`).
- No static import of a Node module: the plugin must load on mobile. Use a dynamic `import()` guarded by `Platform.isDesktop` (`obsidianmd/no-nodejs-modules`).
- No `any` may reach a call, member access, assignment or return: type the value (`@typescript-eslint/no-unsafe-*`). `moment(...)` imported from `obsidian` is untyped under TypeScript 6: cast `moment` to a small typed function, see "esModuleInterop and moment" in the scanner doc.
- Do not `await` a `Setting` or another UI component: it never settles (`obsidianmd/no-await-chainable`). A `checkCallback` or `editorCheckCallback` must read `checking`.
- `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` print as an advisory line. Type the code instead.

The plugin's own `npm run lint` (`obsidianPlugin()` from the kit) adds rules the scorecard does not have:

- A bare `window.<member>` becomes `activeWindow.<member>`. `window.open` and the timer functions above stay on `window`.
- Unused arguments, variables and caught errors are errors unless their name starts with `_`.

Details and the reasons behind each rule: `node_modules/obsidian-plugin-dev-kit/docs/scanner.md`.
