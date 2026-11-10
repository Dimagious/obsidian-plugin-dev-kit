# Kit e2e smoke

The kit's own end-to-end check of `src/e2e`: two tiny prebuilt plugins (`plugins/`), a seed vault (`vault/`) and the
specs in `e2e/`. It starts the real Obsidian, so it opens windows. It is **not** part of `npm test` or CI; run it by
hand before a release:

```sh
env -u VAULT_PLUGIN npm run e2e:smoke
```

`VAULT_PLUGIN` is the dev-vault variable of `opdk build --vault`. The fixture removes it from Obsidian's environment
anyway; `env -u` keeps it out of everything else. The run needs the Obsidian app on the machine (`OBSIDIAN_PATH` to
point at another `app.asar`) and the `electron` devDependency, which downloads its binary on first use.

What it checks: no trust dialog and no vault picker, both plugins loaded, a command and a settings tab that a plugin
registers after an `await` in `onload()` exist as soon as the fixture resolves, settings open in the main window,
the version annotation, `window.confirm()` does not hang, `data.json` is seeded, a write through `vault` lands in the copy and not in the seed, and, once the run ends, no
`opdk-e2e-*` temp folder and no Obsidian process is left (`leftovers.ts`). The plugins are committed as built files so
that no build step stands between a change in the kit and this run.

`npx playwright test -c test/e2e-fixture/playwright.config.ts --list` lists the specs without launching anything.

## Checking the failure artifacts

The Obsidian window is not a browser context that Playwright created, so the kit applies `use.trace` and `use.video`
itself (`src/e2e/artifacts.ts`). One spec fails on purpose to show it; it is skipped unless asked for:

```sh
env -u VAULT_PLUGIN OPDK_E2E_FORCE_FAIL=1 npm run e2e:smoke -- -g "artifacts"
```

Expect the run to fail (that is the point) and `test-results/` to hold, for that test:

- `obsidian-trace.zip`: open it with `npx playwright show-trace`; it has `resources/*.jpeg` screencast frames and the
  actions (`waitForTimeout`, `click`) as events, not only the runner steps.
- a `.webm` video of the window.
- `test-failed-1.png`.

The leftover check at the end of the run must still pass: no `opdk-e2e-*` folder and no Obsidian process remain.
