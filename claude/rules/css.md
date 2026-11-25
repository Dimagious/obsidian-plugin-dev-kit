---
paths: ["**/*.css"]
---

# Stylesheets and the community scorecard

The scorecard reads every tracked `.css` file in the repository, a docs site's stylesheets included. `opdk scan` checks the same files against Chrome 142 (the Chromium of Obsidian 1.11.4).

- No `!important`. Raise the selector's specificity instead (`css-no-important`).
- No `:has()`. Put a class on the element from TypeScript and select that (`css-no-has`).
- Only features Chrome 142 supports fully. A partly supported feature is reported too: `text-decoration` passes only as a bare `underline` or `none`. Check the feature on caniuse before using it (`css-browser-feature/<name>`).
- If `src/styles/main.css` exists, `opdk build` builds `styles.css` from it. Edit the files in `src/styles/` and rebuild; an edit to `styles.css` is lost on the next build.

Details: `node_modules/obsidian-plugin-dev-kit/docs/scanner.md`.
