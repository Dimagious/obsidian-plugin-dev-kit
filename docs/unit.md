# Unit tests

`obsidian-plugin-dev-kit/vitest` exports `defineUnitConfig()`, the Vitest config Obsidian plugins tend to copy from one another: tests in `src/**/*.test.ts`, v8 coverage with a gate of 90 percent (80 for branches), an `obsidian` alias, and a split between test files that run in node and files that need a DOM. `obsidian-plugin-dev-kit/vitest/dom` installs Obsidian's DOM helpers (`createDiv`, `setText`, `addClass`, `activeDocument` and the rest) on jsdom. The kit adds no command: you keep `vitest run --coverage` as your `test` script.

## Why

- **The same config gets copied between plugins.** The copies differ in coverage lists and the stub path, and each one tracks by hand that `vitest` and `@vitest/coverage-v8` move together (otherwise `ERESOLVE`) and which Node version Vitest 5 needs (jsdom 30 failed on Node 20 in CI).
- **Hand-written copies of Obsidian's DOM helpers drift.** Two plugins each had their own polyfill (97 and 274 lines), and they disagreed. In one, `setText`, and `createEl({ text })` in both, turned a `DocumentFragment` into a string, while Obsidian appends the fragment. The kit's version follows the behaviour of the shipped app (Obsidian 1.14.5) and is tested.
- **jsdom starts for every test file.** In a trial on a plugin with 85 test files and 3,271 tests, the run took 30.3 s, 85 percent of it starting jsdom. With the 32 files that need a DOM in the `dom` list and the other 53 in node, the same tests ran in 15.0 s.
- **A file nobody imports escapes the coverage gate.** Vitest 4 and later report only files a test imported, unless `coverage.include` says which files count. The preset makes `coverage.include` required.

## Quick start

Install what the preset runs on next to the kit (the same version of `vitest` and `@vitest/coverage-v8`, and `jsdom` only if some tests need a DOM), then add `vitest.config.ts`. The kit does not declare these as peer dependencies: `defineUnitConfig()` checks their versions when it runs ([Required versions](#required-versions-checked-at-run-time)).

```bash
npm install --save-dev vitest@^5 @vitest/coverage-v8@^5 vite@^8 jsdom@^30
```

```ts
// vitest.config.ts
import { defineUnitConfig } from "obsidian-plugin-dev-kit/vitest";

export default defineUnitConfig({
    rootDir: import.meta.dirname,
    obsidian: "./src/test/stubs/obsidian.ts",
    dom: ["src/ui/**/*.test.ts"],
    coverage: {
        include: ["src/**/*.ts"],
        exclude: ["src/main.ts", "src/types.ts"],
    },
});
```

```json
{ "scripts": { "test": "vitest run --coverage" } }
```

Only `coverage.include` is required. Coverage is switched on in the config, so a plain `vitest run` also collects it; `vitest run --coverage.enabled=false` turns it off for a quick run. The config is plain data: spread it, or pass it to `mergeConfig` from `vitest/config`, to add whatever is yours (`test.setupFiles`, `test.testTimeout`, `resolve.alias`).

Vitest 5 needs Node 22.12 or newer (22.22.2 with jsdom). It declares `vite` (`^6.4 || ^7 || ^8`) as a peer dependency, which npm 7 and newer install automatically. List `vite` in your `devDependencies` anyway, so your `package.json` pins the version your tests run on.

## Options

All keys of the object passed to `defineUnitConfig()`. An unknown key, or a value of the wrong type, throws and names the option.

| Option | Type | Default | What it does |
|---|---|---|---|
| `coverage` | object | required | See the next table |
| `obsidian` | string or `{ node, dom }` | no alias | How `import "obsidian"` resolves in tests: a path to your own stub (relative to `rootDir`), `"obsidian-test-mocks"`, or one of each per project: `{ node: "<stub path>", dom: "obsidian-test-mocks" \| "<stub path>" }` |
| `dom` | string[] or `"all"` | `[]` | Test files that need a DOM, as globs relative to the folder of `vitest.config.ts`. `"all"` puts every test file in jsdom; omitted or `[]` runs everything in node |
| `include` | string[] | `["src/**/*.test.ts"]` | Test file globs, relative to the folder of `vitest.config.ts` |
| `rootDir` | string | `process.cwd()` | The folder the `obsidian` stub path is resolved against. Pass `import.meta.dirname` so the config works from any working directory |

`coverage`:

| Option | Type | Default | What it does |
|---|---|---|---|
| `include` | string[] | required | Globs of the files the gate counts, for example `["src/**/*.ts"]` |
| `exclude` | string[] | `[]` | Added to the base list `**/*.test.ts`, `src/test/**`, `**/*.d.ts`, which is always excluded |
| `thresholds` | object | `{ lines: 90, functions: 90, statements: 90, branches: 80 }` | Raise individual values. Each key is `lines`, `functions`, `statements` or `branches`, a number from 0 to 100 |
| `allowLowerThresholds` | boolean | `false` | Lets a value in `thresholds` go below the default. Without it a lower value throws |
| `extraReporters` | `("lcov" \| "html")[]` | `[]` | Reports written next to `text` and `json-summary`. The report folder is `coverage` |

What the config sets besides these: the v8 provider, `coverage.enabled: true`, the `text` and `json-summary` reporters, the environment `node` (jsdom for the files in `dom`).

### The coverage list and the floor

Vitest 4 removed `coverage.all`, and Vitest 5 keeps it that way: without `coverage.include`, a source file that no test imports is not in the report, so the gate cannot fail for it. The config throws when `coverage.include` is missing instead of letting that through. List what the gate must count. One way is an allow-list (`src/core/**/*.ts`, `src/api/**/*.ts`) when the UI is left to the end-to-end tests; the other is `src/**/*.ts` with an `exclude` for the files tested elsewhere, each with a comment saying why.

The defaults are a floor, not a goal: bugs have shipped on fully covered lines, so the number says little about test quality. Raising a value is fine (`thresholds: { branches: 85 }`). Lowering one needs `allowLowerThresholds: true`, so it is a visible, reviewed decision:

```ts
coverage: { include: ["src/**/*.ts"], thresholds: { branches: 70 }, allowLowerThresholds: true },
```

### lcov for a coverage service

`extraReporters: ["lcov"]` writes `coverage/lcov.info`, the file a service like Codecov reads. `"html"` writes `coverage/index.html` for reading locally. `json-summary` is always on, so scripts can read `coverage/coverage-summary.json`. When Vitest detects an AI coding agent it hides fully covered files in the `text` table, which does not change the files in `coverage/`.

### `obsidian`: your own stub or obsidian-test-mocks

The `obsidian` package contains types only, so `import { Notice } from "obsidian"` fails at run time unless tests resolve it somewhere.

- **A path** (`"./src/test/stubs/obsidian.ts"`): the kit aliases `obsidian` to that file in every project, node and DOM. The stub is yours and stays in the plugin.
- **`"obsidian-test-mocks"`**: the [obsidian-test-mocks](https://www.npmjs.com/package/obsidian-test-mocks) package. The kit uses that package's `vitest-setup` file as the setup file of the DOM tests and does not install its own polyfill, because the package installs the same helpers (and patches more, among them some JavaScript built-ins). The kit also aliases `obsidian` to the package's own `obsidian` module, because the types package has no JavaScript entry. It needs a DOM: `dom` must list files or be `"all"`, or the config throws. The alias and the setup file belong to the `dom` project only, so a node test that imports `obsidian` cannot resolve it. Use the `{ node, dom }` form below when the plugin has such tests.
- **`{ node, dom }`**: one value per project. `node` is a path to your own stub, used by the files that run in node. `dom` is `"obsidian-test-mocks"` or another stub path, used by the files in the `dom` list. Both are required, unknown keys throw, and `node` cannot be `"obsidian-test-mocks"` (the package needs a DOM). With `dom: "all"` there is no node project, so only the `dom` side is used.
- **Omitted**: no alias. Fine for tests of code that never imports `obsidian`.

```ts
export default defineUnitConfig({
    rootDir: import.meta.dirname,
    obsidian: { node: "./src/test/stubs/obsidian.ts", dom: "obsidian-test-mocks" },
    dom: ["src/ui/**/*.test.ts"],
    coverage: { include: ["src/**/*.ts"] },
});
```

#### obsidian-test-mocks for settings tabs and modals

The kit has no mock of its own and recommends obsidian-test-mocks for UI tests of settings tabs and modals, where a hand-written stub grows quickly.

- **Pin an exact version** (`"obsidian-test-mocks": "8.0.0"`, no `^`). The package ships a new major every few weeks, and a major can change what a test sees. Tell Dependabot to ignore major updates for it, and bump it on purpose.
- **Install it in the plugin, use it in the `dom` project only.** The `{ node, dom }` form above does that: node tests keep the stub they have.
- **Peer dependencies**: `obsidian`, `moment`, `@codemirror/view` and `@codemirror/state` (jest or vitest, optional). The `dom` project also needs `jsdom` in the plugin.
- **Known gaps in 8.0.0.** Check the package README before you rely on a behaviour; they may be fixed later:
    - Declarative `control` setting rows are not modelled, so `renderTab` throws on a tab that uses them.
    - `SettingTab.update()` does not redraw.
    - `Modal.open()` closes on the next tick. Call `onOpen()` directly in the test.
    - The mock app is a strict proxy: reading a private app property the package does not model throws. Assign it on the mock in the test.

## Running DOM tests in jsdom only where needed

With `dom: [...]` globs, the config has two Vitest projects. `unit` runs every test file that matches `include` and is not in the `dom` list, in node. `dom` runs the listed files in jsdom, with the Obsidian DOM helpers installed by a setup file. The coverage gate stays at the root, so it counts both projects. With `dom: "all"` there is one project, in jsdom with the setup file; with `dom` omitted, one project in node.

**Linked installs.** The setup file of the `dom` project lives in the kit's folder. With `npm link` or `file:../obsidian-plugin-dev-kit`, `node_modules/obsidian-plugin-dev-kit` is a symlink, so the file's real path is outside your plugin, and Vite's `server.fs.strict` would refuse to serve it (`Cannot find module '/@fs/.../dist/vitest/dom/setup.js'`). The preset handles it: when the kit's folder is outside `rootDir`, it sets `server.fs.allow` to your workspace root (the folder Vite allows by default: the nearest parent with `pnpm-workspace.yaml`, `lerna.json` or `workspaces` in `package.json`, else the nearest `package.json`) and the kit's `dist/vitest/dom` folder. `fs.strict` stays on. Installs from a git tag are copies inside `node_modules` and usually get no `server` key (when your plugin's path goes through a symlink, an extra entry inside the plugin may appear; it is harmless). `mergeConfig` appends your own `server.fs.allow` entries to these; a plain spread (`server: { fs: { allow: [...] } }` after `...defineUnitConfig()`) replaces them, so list the workspace root and the kit's folder yourself or use `mergeConfig`.

Finding the files that need a DOM: start with `dom: []`, run the tests, and look at the failures. A file that needs a DOM fails in node with one of these errors, the first being `document is not defined`:

- `ReferenceError: document is not defined`
- `ReferenceError: window is not defined`
- `ReferenceError: DOMParser is not defined`
- `ReferenceError: createDiv is not defined` (or `createEl`, `createSpan`, `createFragment`, `activeDocument`, `activeWindow`)

To list the failing files in one go:

```bash
npx vitest run --no-color --coverage.enabled=false 2>&1 | grep -E "^ FAIL " | sed 's/^ FAIL  //; s/^|[^|]*| //; s/ \[.*//; s/ >.*//' | sort -u
```

It needs a POSIX shell. It prints every failing file, not only the ones that lack a DOM, so read the error of each before listing it. Add the globs of those files to `dom` and run again. Directory globs (`src/ui/**/*.test.ts`) cover most of it; single files cover the rest. The shape of such a list:

```ts
dom: [
    "src/ui/**/*.test.ts",
    "src/views/**/*.test.ts",
    "src/core/render.test.ts",
    "src/settings/tab.test.ts",
],
```

Notes:

- **A per-file `// @vitest-environment jsdom` comment still works.** In a file of the `unit` project it gives that file jsdom, but not the polyfill, because the setup file belongs to the `dom` project. Such a file calls `installObsidianDom()` itself, or moves to the `dom` list, which is simpler.
- **Globs are relative to the folder of `vitest.config.ts`**, and a file matching both lists runs only in `dom`.
- **Vitest 5 appends a project's `include` to the root one.** The config therefore sets the root `include` only when there are no projects, and puts `include` inside each project otherwise.

## `isolate: false` for jsdom-heavy suites

By default Vitest gives every test file a fresh module registry and global scope. That is what costs time in a jsdom-heavy suite. `test.isolate: false` lets the files that share a worker share their modules and globals, which is faster and unsafe: it is an option to try, never a default, and the preset does not set it. Add it with `mergeConfig` (the projects extend the root config):

```ts
export default mergeConfig(defineUnitConfig({ /* ... */ }), { test: { isolate: false } });
```

Two plugins tried it. One jsdom-heavy suite went from 20.6 s to 6.7 s (3x) after four leaks were fixed first. The other ran 1.8x faster and was green on two and three workers, but six tests failed on one worker in default order, and between six and 37 failed in every shuffled seed. The same switch is a gain for one suite and a source of failures for the next.

A leak is state one file leaves behind and a later file in the same worker reads. Typical ones:

- a `vi.mock` of a module that another file already loaded: the mock never reaches that module, or reaches it for the files that run after it;
- the `moment` locale, and date or locale overrides (`Intl`, a patched `Date`, a timezone) that one file sets and never restores;
- DOM left in `document` (a modal, a container appended to `body`) that a later file queries;
- globals a test sets (`window.app`, `globalThis` fields, a patched `console`, fake timers) and does not restore.

Prove the suite before relying on it, on one worker, in shuffled order, for several seeds, because with many workers each worker gets few files and the leaks stay hidden:

```bash
for seed in 1 2 3 4 5; do npx vitest run --maxWorkers=1 --sequence.shuffle --sequence.seed=$seed --coverage.enabled=false || break; done
npx vitest run --maxWorkers=1 --coverage.enabled=false
npx vitest run --maxWorkers=2 --coverage.enabled=false
npx vitest run --maxWorkers=3 --coverage.enabled=false
```

Every run has to pass: the shuffled ones, the default order on one worker, and the default order on two and three workers. A failure names a file that leaks into the next one: fix it with `afterEach` cleanup (`vi.restoreAllMocks()`, `document.body.replaceChildren()`, restoring the global) and run the loop again. If the suite does not gain, or the fixes cost more than the saved time, leave `isolate` on.

## The DOM polyfill

`installObsidianDom()` and `uninstallObsidianDom()` come from `obsidian-plugin-dev-kit/vitest/dom`. The `dom` project runs the setup file `obsidian-plugin-dev-kit/vitest/dom/setup`, which calls `installObsidianDom()` once per test file, so you rarely call it yourself. For hand use, in a test file that runs under jsdom:

```ts
import { installObsidianDom, uninstallObsidianDom } from "obsidian-plugin-dev-kit/vitest/dom";

beforeAll(installObsidianDom);
afterAll(uninstallObsidianDom);
```

Install twice is a no-op. Install without a DOM throws: "installObsidianDom() needs a DOM and this test runs in the node environment. Add `// @vitest-environment jsdom` to the top of the test file, or list the file in the `dom` option of defineUnitConfig()." `uninstallObsidianDom()` puts back what was there before and removes what was added.

The behaviour of each helper was read from the shipped Obsidian app (1.14.5, the code in `app.asar`, never by running the app) and has unit tests in the kit. Covered, and nothing else:

- **Create:** `createEl`, `createDiv`, `createSpan` and `createFragment` as globals; `createEl`, `createDiv`, `createSpan` on every node. The info object takes `cls`, `text` (a string or a fragment), `attr` (a `null` value removes the attribute), `title`, `value`, `type`, `placeholder`, `href`, `parent`, `prepend` and `on*` listeners, and the callback argument works. The info can also be a plain string, which is the class.
- **Node:** `appendText`, `empty`, `instanceOf`, `doc`, `win`, `constructorWin`.
- **Element:** `setText` (a string or a node or fragment, which replaces the children), `getText`, `setAttr`, `setAttrs`, `getAttr`, `addClass`, `addClasses`, `removeClass`, `removeClasses`, `toggleClass`, `hasClass`, `find`, `findAll`, `findAllSelf`; `find` and `findAll` on fragments.
- **HTMLElement:** `show`, `hide`, `toggle`, `isShown`, `setCssStyles`, `setCssProps`, `onClickEvent` (`setCssStyles` and `setCssProps` also on SVG elements).
- **Globals:** `activeWindow` and `activeDocument`.

An existing `show`, `hide`, `toggle`, `activeWindow` or `activeDocument` is left alone.

Two deviations from the app, both forced by jsdom:

- **`isShown`** is true for an element that is in the document with no inline `display: none` on itself or an ancestor. The app returns `!!offsetParent`, which jsdom, having no layout, always reports as `null`.
- **`scrollIntoView`** is added as a no-op when jsdom lacks it. The app has no such helper; browsers do, and code that scrolls an element into view fails without it.

The helpers call each other through the public methods, as the app does: `createDiv` and `createSpan` go through `this.createEl`, the global `createDiv` through the global `createEl`, `addClass` through `addClasses`, `removeClass` through `removeClasses` and `toggle` through `show` and `hide`. A test that spies on `createEl` therefore sees the calls of `createDiv`. Like the app, `createEl` on a node writes `parent` into the info object it was given; the global `createEl` does not mutate it.

## Required versions, checked at run time

The kit declares no peer dependency on `vitest`, `@vitest/coverage-v8` or `jsdom`. npm checks even an optional peer when the package is installed, so a plugin still on Vitest 3 or jsdom 26 could not install the kit at all (`ERESOLVE`), although it never uses the unit preset. `defineUnitConfig()` looks the packages up from `rootDir` instead, the way the plugin's own code resolves them, and throws before building the config when a version does not fit:

| Package | Required | When | Notes |
|---|---|---|---|
| `vitest` | major 5 (`^5.0.0`) | always | Node 22.12 or newer (22.22.2 with jsdom). The kit's own tests run on it |
| `@vitest/coverage-v8` | the same version as `vitest` | always | Two versions of the pair fail with `ERESOLVE` in the plugin and are rejected here |
| `jsdom` | 30 or newer (`>=30.0.0`) | `dom` globs or `"all"` | The version the `dom` project and the kit's own tests run on, and the lowest one tested. Needs Node 22.22.2+, 24.15+ or 26+; older Node fails with `webidl.util.markAsUncloneable is not a function` |
| `vite` | `^6.4 \|\| ^7 \|\| ^8` | not checked | A peer of Vitest 5 that npm 7 and newer install automatically; list it in your dev dependencies to pin the version |

Every problem is reported in one error, with the command that fixes all of them:

```
defineUnitConfig(): "vitest" 3.2.4 is installed; the kit needs ^5.0.0.
defineUnitConfig(): "@vitest/coverage-v8" 3.2.4 is installed; the kit needs ^5.0.0.
defineUnitConfig(): "jsdom" 26.1.0 is installed; the kit needs >=30.0.0.
Run: npm install --save-dev vitest@^5.0.0 @vitest/coverage-v8@^5.0.0 "jsdom@>=30.0.0"
```

A package that is not installed gives `"<name>" is not installed; the kit needs <range>.` With `vitest` 5 present and a different `@vitest/coverage-v8`, the message names both versions and installs the coverage package at the version of `vitest`. `jsdom` is not checked when every test runs in node.

## Type-check the tests

Recommended, not required: let `tsc --noEmit` cover the test files. Many plugins exclude `*.test.ts` from `tsconfig.json`, so a type error in a test is found only when the test fails at run time. The preset does not check types. Tests often need more than the plugin's build does: they spread a `NodeList` (`[...container.querySelectorAll("li")]`, which needs `DOM.Iterable`) or use ES2022 features that the plugin's `lib` leaves out on purpose. Do not widen the plugin's own `tsconfig.json` for that; add a `tsconfig.test.json` and point a script at it:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"], "noEmit": true },
  "include": ["src/**/*.ts", "src/**/*.test.ts", "src/test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

```json
"typecheck:tests": "tsc -p tsconfig.test.json"
```

The plugin keeps its target `lib`, so `tsc` on the build config still rejects an API the plugin must not call. (TypeScript 6 includes `DOM.Iterable` in `DOM`; listing it is harmless.) Take the `include` globs from where your tests and their helpers live.

Two things show up when a plugin first type-checks its tests:

- **A test that imports the plugin class from `../main` resolves the built `main.js`**, next to `main.ts`, not the source. The bundle has no types, so the import is `any` and the test checks nothing. Import from the source file that exports the class (for example `../plugin`), not from `main`.
- **The preset's lint does not read `*.test.ts`.** `obsidianPlugin()` ignores `src/**/*.test.ts` (it is in `DEFAULT_IGNORES`), so a test is never linted by `eslint .`. Helpers are different: a file such as `src/test/helpers.ts` is linted like any source file unless the plugin lists it in `ignores`. Keep helpers out of `ignores` so they are linted, and name them without `.test.ts`. The type check above is what covers the test files themselves.

## Migrating a plugin

List each change a plugin makes while adopting the module in its changelog, and run its end-to-end tests afterwards.

1. **On Vitest 3 or older, bump to 5 first**, with `@vitest/coverage-v8` and `jsdom`, as a change of its own. Expect failures from mocks written for older versions: `vi.fn(arrow)` used as a constructor (a mock of `Notice`, for example) does not work on Vitest 5. Use a `class` or a `function` in the mock.
2. **Delete your own copy of Obsidian's DOM helpers** and remove `environment`, `coverage.reportsDirectory` and the setup file of the old DOM polyfill (the preset adds its own to the `dom` project, or to the root with `dom: "all"`). Keep other setup files and add them with `mergeConfig`. Remove calls such as `installObsidianDomHelpers()` from `beforeAll`. The files that needed them go into `dom`. A test that relied on a fragment becoming a string in `setText` output was asserting a bug.
3. **Replace `vitest.config.ts`** with `defineUnitConfig()`. Point `obsidian` at the plugin's existing stub, and copy its coverage lists into `coverage.include` and `coverage.exclude`. Reporters other than `text` and `json-summary` go into `extraReporters`.
4. **Find the `dom` globs** with the method above. If the plugin ran every test file in jsdom, the files that do not need it now run in node: a visible change, list it in the changelog.
5. **A plugin with no DOM tests** has nothing to split: leave `dom` out.

## Reading a run

A trial on a plugin with 85 test files, with the split in place (Vitest 5.1.0):

```text
 RUN  v5.1.0 /path/to/your-plugin
      Coverage enabled with v8

 Test Files  85 passed (85)
      Tests  3271 passed (3271)
   Duration  15.02s (environment 65%, import 17%, tests 8%, transform 7%, worker 3%)
```

`environment` is the time spent starting jsdom and node workers. Before the split it was 85 percent of 30.27 s. When a threshold fails, Vitest prints which one and exits non-zero, in a line of the form `ERROR: Coverage for branches (78.4%) does not meet global threshold (80%)`. The threshold error of the kit itself is different and comes before any test runs: `defineUnitConfig(): threshold "branches: 70" is below the default 80. The default is a floor. Raise the coverage, or set allowLowerThresholds: true to lower it on purpose.`
