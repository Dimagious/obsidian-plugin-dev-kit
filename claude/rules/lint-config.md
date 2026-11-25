---
paths: ["eslint.config.*", "tsconfig*.json", "e2e/**/*"]
---

# ESLint and TypeScript config for the scanner

- The ESLint config is `eslint.config.mjs` built on `obsidianPlugin({ rootDir: import.meta.dirname })` from `obsidian-plugin-dev-kit/eslint`. A `.js` or `.ts` config that imports the kit gets `no-unsafe-*` warnings on the scorecard, because the scanner installs the kit without building it. A block `eslint-disable` is not a fix: it fails the plugin's own lint.
- Do not enable `@typescript-eslint/no-misused-promises`: the preset replaces it with `obsidianmd/no-misused-promises`.
- The scanner lints every file a `tsconfig.json` covers, with types. Keep e2e type-checking in a root `tsconfig.e2e.json`. An `e2e/tsconfig.json` puts the e2e helpers on the scorecard, with `no-unsafe-*` warnings from the kit's imports that no code change removes.
- TypeScript is 6.0.x. `opdk scan` fails before linting on TypeScript 5, because the scanner type-checks with 6.
- `npm run lint` leaves `e2e/` out by default, `opdk scan` does not: in `e2e/` files a tsconfig covers, timers still go on `window` and Node modules still count.

Details: `node_modules/obsidian-plugin-dev-kit/docs/scanner.md`.
