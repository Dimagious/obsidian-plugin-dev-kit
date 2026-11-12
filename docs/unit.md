# Unit tests

`obsidian-plugin-dev-kit/vitest` exports `defineUnitConfig()`, the Vitest config Obsidian plugins tend to copy from one another: tests in `src/**/*.test.ts`, v8 coverage with a gate of 90 percent (80 for branches), an `obsidian` alias, and a split between test files that run in node and files that need a DOM. `obsidian-plugin-dev-kit/vitest/dom` installs Obsidian's DOM helpers (`createDiv`, `setText`, `addClass`, `activeDocument` and the rest) on jsdom. The kit adds no command: you keep `vitest run --coverage` as your `test` script.

## Why

- **The same config gets copied between plugins.** The copies differ in coverage lists and the stub path, and each one tracks by hand that `vitest` and `@vitest/coverage-v8` move together (otherwise `ERESOLVE`) and which Node version Vitest 5 needs (jsdom 30 failed on Node 20 in CI).
- **Hand-written copies of Obsidian's DOM helpers drift.** Two plugins each had their own polyfill (97 and 274 lines), and they disagreed. In one, `setText`, and `createEl({ text })` in both, turned a `DocumentFragment` into a string, while Obsidian appends the fragment. The kit's version follows the behaviour of the shipped app (Obsidian 1.14.5) and is tested.
- **jsdom starts for every test file.** In a trial on a plugin with 85 test files and 3,271 tests, the run took 30.3 s, 85 percent of it starting jsdom. With the 32 files that need a DOM in the `dom` list and the other 53 in node, the same tests ran in 15.0 s.
- **A file nobody imports escapes the coverage gate.** Vitest 4 and later report only files a test imported, unless `coverage.include` says which files count. The preset makes `coverage.include` required.

## Quick start

Install the peers next to the kit (the same version of `vitest` and `@vitest/coverage-v8`, and `jsdom` only if some tests need a DOM), then add `vitest.config.ts`:

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

Vitest 5 needs Node 22.12 or newer (22.22.2 with jsdom) and no longer installs `vite` itself, so add `vite` (6.4 or newer) as a dev dependency if your project does not have it.

## Options

All keys of the object passed to `defineUnitConfig()`. An unknown key, or a value of the wrong type, throws and names the option.

| Option | Type | Default | What it does |
|---|---|---|---|
| `coverage` | object | required | See the next table |
| `obsidian` | string | no alias | How `import "obsidian"` resolves in tests: a path to your own stub (relative to `rootDir`), or `"obsidian-test-mocks"` |
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
- **`"obsidian-test-mocks"`**: the [obsidian-test-mocks](https://www.npmjs.com/package/obsidian-test-mocks) package. The kit uses that package's `vitest-setup` file as the setup file of the DOM tests and does not install its own polyfill, because the package installs the same helpers (and patches more, among them some JavaScript built-ins). The kit also aliases `obsidian` to the package's own `obsidian` module, because the types package has no JavaScript entry. The package must be a dependency of your plugin (with its own peer dependencies), and it needs a DOM: `dom` must list files or be `"all"`, or the config throws. The package ships a new major every few weeks, so pin it to an exact version.
- **Omitted**: no alias. Fine for tests of code that never imports `obsidian`.

In mocks mode the alias and the setup file belong to the `dom` project only. A test file that runs in node and imports `obsidian`, directly or through the code it tests, cannot resolve it. Keep pure files free of `obsidian` imports, or list the file in `dom`. With `dom: "all"` there is no such split.

## Running DOM tests in jsdom only where needed

With `dom: [...]` globs, the config has two Vitest projects. `unit` runs every test file that matches `include` and is not in the `dom` list, in node. `dom` runs the listed files in jsdom, with the Obsidian DOM helpers installed by a setup file. The coverage gate stays at the root, so it counts both projects. With `dom: "all"` there is one project, in jsdom with the setup file; with `dom` omitted, one project in node.

Finding the files that need a DOM: start with `dom: []`, run the tests, and look at the failures. A file that calls an Obsidian helper in node fails with `ReferenceError: createDiv is not defined` (or `createEl`, `createSpan`, `createFragment`, `activeDocument`, `activeWindow`), or with `document is not defined` when it touches the DOM directly. Add the globs of those files to `dom` and run again. Directory globs (`src/ui/**/*.test.ts`) cover most of it; single files cover the rest. The shape of such a list:

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

## Peer versions

| Package | Range | Notes |
|---|---|---|
| `vitest` | `^5.0.0` | Node 22.12 or newer (22.22.2 with jsdom). The kit's own tests run on it |
| `@vitest/coverage-v8` | `^5.0.0` | Install the same version as `vitest`; a mismatch gives an `ERESOLVE` error |
| `jsdom` | `^30.0.0` | Only when `dom` is used. Needs Node 22.22.2+, 24.15+ or 26+; older Node fails with `webidl.util.markAsUncloneable is not a function` |
| `vite` | 6.4 or newer | Vitest 5 does not install it; add it to your dev dependencies |

All three kit peers are optional, so a plugin that does not use the module does not install them.

## Type-check the tests

Recommended, not required: let `tsc --noEmit` cover the test files. Many plugins exclude `*.test.ts` from `tsconfig.json`, so a type error in a test is found only when the test fails at run time. The preset does not check types. A plugin that wants it removes `*.test.ts` from the `exclude` of its `tsconfig.json`, so the `typecheck` script covers them.

## Migrating a plugin

List each change a plugin makes while adopting the module in its changelog, and run its end-to-end tests afterwards.

1. **On Vitest 3 or older, bump to 5 first**, with `@vitest/coverage-v8` and `jsdom`, as a change of its own. Expect failures from mocks written for older versions: `vi.fn(arrow)` used as a constructor (a mock of `Notice`, for example) does not work on Vitest 5. Use a `class` or a `function` in the mock.
2. **Delete your own copy of Obsidian's DOM helpers** and its `setupFiles` entry, and remove calls such as `installObsidianDomHelpers()` from `beforeAll`. The files that needed them go into `dom`. A test that relied on a fragment becoming a string in `setText` output was asserting a bug.
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
