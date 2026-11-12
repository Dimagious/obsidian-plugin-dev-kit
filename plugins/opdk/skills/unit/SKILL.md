---
name: unit
description: Set up, extend or fix the Vitest unit tests of an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk) with `defineUnitConfig()` from `obsidian-plugin-dev-kit/vitest`. Use it for a `vitest.config.ts`, the coverage gate (thresholds, "Coverage for branches does not meet global threshold", `coverage.include`, lcov for Codecov), choosing which test files run in jsdom, "document is not defined" or "createDiv is not defined" or "installObsidianDom() needs a DOM" failures, the `obsidian` alias or obsidian-test-mocks, Obsidian's DOM helpers in jsdom (`createEl`, `setText`, `addClass`, `activeDocument`), a slow Vitest run that boots jsdom for every file, or moving a plugin's own vitest config and DOM polyfill to the kit. Not for Playwright specs in the real Obsidian (e2e), build or bundle errors (build), scorecard warnings (scanner), demo films (demo) or tagging a release (release).
---

# opdk unit module

`defineUnitConfig()` returns a plain Vitest config: tests in `src/**/*.test.ts`, v8 coverage with the gate 90 lines, functions and statements and 80 branches, an `obsidian` alias, and a split between node and jsdom. Run commands from the plugin root. The `test` script stays `vitest run --coverage`; the kit adds no command. Full docs: https://github.com/Dimagious/obsidian-plugin-dev-kit/blob/main/docs/unit.md

## Safety

- Unit tests never start Obsidian. Do not launch the Obsidian app to check a helper; its behaviour is in `docs/unit.md`, and reading it from `app.asar` is the only way to verify more.
- Do not lower a threshold to make a run pass. `thresholds` below the default throw unless `allowLowerThresholds: true`; set that only when the owner decided so.
- Do not move a file to `coverage.exclude` to hide a gap without a comment saying why; the gate is a floor, and an excluded file escapes it.

## Set up a plugin

1. devDependencies: `vitest` and `@vitest/coverage-v8` at the same `^5` version, `vite` (`^6.4 || ^7 || ^8`; a peer of Vitest 5 that npm installs automatically, listed so `package.json` pins it), `jsdom` `^30` when some tests need a DOM, and the kit pinned to an exact tag. Vitest 5 needs Node 22.12 or newer (22.22.2 with jsdom).
2. `vitest.config.ts`:

```ts
import { defineUnitConfig } from "obsidian-plugin-dev-kit/vitest";

export default defineUnitConfig({
    rootDir: import.meta.dirname,
    obsidian: "./src/test/stubs/obsidian.ts",
    dom: ["src/ui/**/*.test.ts"],
    coverage: { include: ["src/**/*.ts"], exclude: ["src/main.ts", "src/types.ts"] },
});
```

3. `"test": "vitest run --coverage"` in `package.json`. Coverage is on in the config, so `vitest run --coverage.enabled=false` is the quick run.

Options: `coverage.include` (required), `coverage.exclude` (added to `**/*.test.ts`, `src/test/**`, `**/*.d.ts`), `coverage.thresholds` (raise only), `coverage.allowLowerThresholds`, `coverage.extraReporters` (`"lcov"`, `"html"`; `text` and `json-summary` are always on), `obsidian` (stub path, `"obsidian-test-mocks"`, or `{ node: "<stub path>", dom: "obsidian-test-mocks" | "<stub path>" }`), `dom` (globs, or `"all"`), `include` (default `["src/**/*.test.ts"]`), `rootDir` (pass `import.meta.dirname`). An unknown key, or a value of the wrong type, throws and names the option.

## Choose the dom globs

Tests run in node unless listed in `dom`. To find the files that need a DOM:

1. Start with no `dom` and run `npx vitest run --coverage.enabled=false`.
2. A file that needs the DOM fails with `ReferenceError: document is not defined`, `window is not defined`, `DOMParser is not defined`, or `createDiv is not defined` (or `createEl`, `createSpan`, `createFragment`, `activeDocument`, `activeWindow`). To list the failing files (needs a POSIX shell): `npx vitest run --no-color --coverage.enabled=false 2>&1 | grep -E "^ FAIL " | sed 's/^ FAIL  //; s/^|[^|]*| //; s/ \[.*//; s/ >.*//' | sort -u` (it lists every failing file, so read each error first).
3. Add those files (a directory glob such as `src/ui/**/*.test.ts` when the whole folder is DOM code, single paths otherwise) to `dom`, relative to the folder of `vitest.config.ts`, and run again until green.

`dom: "all"` puts every file in jsdom (slow, but one project). Do not list files that pass in node: each jsdom file pays the start-up cost. A `// @vitest-environment jsdom` comment in a node-project file gives jsdom without the Obsidian helpers; list the file in `dom` instead, or call `installObsidianDom()` from `obsidian-plugin-dev-kit/vitest/dom` in it.

## Read a failure

- `installObsidianDom() needs a DOM and this test runs in the node environment`: the file calls the install in node. List it in `dom`, or add `// @vitest-environment jsdom`.
- `defineUnitConfig(): "coverage.include" is required`: add the globs of the files the gate counts, for example `["src/**/*.ts"]`. Without them Vitest reports only imported files and an untested file escapes the gate.
- `threshold "branches: 70" is below the default 80`: raise the coverage. `allowLowerThresholds: true` lowers it on purpose.
- `Coverage for <metric> (x%) does not meet global threshold (y%)`: add tests for the files in the `text` table. A fully covered file is hidden from the table when Vitest detects an agent; read `coverage/coverage-summary.json`, or add a `["text", { skipFull: false }]` reporter through `mergeConfig` to show them.
- `obsidian "obsidian-test-mocks" patches the DOM and needs a DOM environment`: mocks mode needs `dom` globs or `"all"`.
- A node-project test cannot resolve `obsidian` in mocks mode (`Failed to resolve entry for package "obsidian"`): the alias is in the `dom` project only. Use `obsidian: { node: "<stub path>", dom: "obsidian-test-mocks" }`, keep the file free of `obsidian` imports, or list it in `dom`.
- `defineUnitConfig(): "obsidian.node" ...` or `"obsidian.dom" ...`: the `{ node, dom }` form needs both keys as non-empty strings, and `node` cannot be `"obsidian-test-mocks"`.
- `"coverage.allowLowerThresholds" must be true or false`: pass a boolean, not a string.
- `ERESOLVE` between `vitest` and `@vitest/coverage-v8`: the two must be the same version. `webidl.util.markAsUncloneable is not a function`: Node is older than jsdom 30 supports (22.22.2, 24.15 or 26).
- Many tests fail after a plugin moves from Vitest 3 to 5, with `vi.fn(arrow)` used as a constructor in an `obsidian` mock (`Notice`): use a `class` or `function` in the mock.
- `isShown()` is true in jsdom for an element in the document without `display: none` (inline, on itself or an ancestor); the app asks for layout, which jsdom does not have. `scrollIntoView` is a no-op.

## Mocks mode

`obsidian-test-mocks` is the recommended way to test UI code (settings tabs, modals); the kit has no mock of its own. `obsidian: "obsidian-test-mocks"` uses that package's `vitest-setup` and its `obsidian` module in the `dom` project and skips the kit's polyfill, because the package installs the same helpers. When node tests also import `obsidian`, keep the plugin's stub for them: `obsidian: { node: "./src/test/stubs/obsidian.ts", dom: "obsidian-test-mocks" }`.

- Install it in the plugin, pinned to an exact version (no `^`), and set Dependabot to ignore major updates for it: new majors come often.
- Its peers: `obsidian`, `moment`, `@codemirror/view`, `@codemirror/state` (jest or vitest, optional). The `dom` project also needs `jsdom`, a peer of the kit.
- Known gaps in 8.0.0 (check the package README): declarative `control` setting rows are not modelled (`renderTab` throws), `SettingTab.update()` does not redraw, `Modal.open()` closes on the next tick (call `onOpen()` directly), and reading a private app property the mock does not model throws (assign it on the mock in the test).
- Do not switch a plugin to it unless the user asks.

## Lcov for a coverage service

`coverage.extraReporters: ["lcov"]` writes `coverage/lcov.info`. A coverage service such as Codecov reads it. Add `"html"` for a local report.

## Type-check the tests

Recommended: let `tsc --noEmit` in the `typecheck` script include the `*.test.ts` files. Not required by the preset. If `[...nodeList]` fails to type-check, add `DOM.Iterable` to `lib`.

## Migrating a plugin

1. On Vitest 3 or older, bump to 5 first (with `@vitest/coverage-v8` and `jsdom`), as its own change. Mocks that use `vi.fn(arrow)` as a constructor (a `Notice` mock, for example) fail on Vitest 5: use a `class` or `function`.
2. Delete the plugin's own copy of Obsidian's DOM helpers and its `setupFiles` entry, and the calls that install the helpers by hand in `beforeAll`. The files that needed them join `dom`. Remove `environment`, `coverage.reportsDirectory` and the setup file of the old DOM polyfill from the old config (the preset adds its own to the `dom` project, or to the root with `dom: "all"`). Keep other setup files and add them with `mergeConfig`.
3. Replace `vitest.config.ts` with `defineUnitConfig()`, point `obsidian` at the existing stub, copy the coverage lists, and move extra reporters (`lcov`, `html`) to `extraReporters`.
4. Find the `dom` globs with the method above. Files that ran in jsdom without needing it now run in node: list that in the plugin's CHANGELOG, and run its e2e after.
5. A plugin with no DOM tests leaves `dom` out.
