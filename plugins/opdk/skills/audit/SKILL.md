---
name: audit
description: Audit how well an Obsidian plugin that already uses obsidian-plugin-dev-kit (opdk) takes advantage of it, then make the changes its author picks. Finds what the plugin still does by hand next to a kit command or helper, pictures and films nothing in the repo can retake or that are stale, code outside the coverage gate, untyped tests, unit runs that only pass in parallel, fixed sleeps in specs, workflow steps the kit's reusable workflows already do, and gaps in the kit itself, each with file:line evidence or a measured value and a triage (KIT, KIT-GENERIC, PLUGIN-ONLY, KNOWN). Use it for "audit this plugin against the kit", "what can we still take from opdk", "what did the migration miss", or a review after a kit upgrade. Not for moving a plugin onto the kit in the first place (build, scanner, e2e, demo, unit, release skills) or for one failing command.
---

# opdk audit

Two phases with a stop between them. Phase 1 reads and measures and changes nothing. The author picks items from its report. Phase 2 does only those items, one branch per coherent change. When the author wants an audit only, phase 1 ends with backlog-ready items instead of branches.

The plugin must already build, scan, test and release through the kit. If it does not, say so and stop: that is a migration, not an audit.

## Safety

- Never start the Obsidian app or binary yourself, not even `--version`: it opens the user's real config and last vault and runs their plugins. Read the version from the app bundle (`Info.plist` on macOS, `resources/app.asar` `package.json`). Obsidian runs only through the kit's e2e fixture, which uses a temp vault and user-data dir.
- No `opdk build --vault` into a real vault. If the shell exports a vault path the plugin's scripts read, unset it for every command (`env -u NAME`).
- Work in a separate worktree. Never change the main clone's remotes, branches or config. If the repo has git hooks that write outside it, pass `git -c core.hooksPath=<empty dir>` on every command that checks out files or commits (read-only git runs no hooks). Never `git config` from a worktree: it writes the main clone's shared config.
- Never `git stash`, `git checkout` or `git reset` over uncommitted work. Do not kill processes or interrupt e2e. Never delete shared temp globs such as `opdk-e2e-*`: every plugin on the kit uses that prefix, and another run may be live.
- Tests never reach real services. Use the plugin's fakes; a live mode stays behind its own opt-in variable.
- Kit findings are reported, never edited from the plugin's repo.

## Phase 1: read

Read in full: the plugin's `CLAUDE.md` or `AGENTS.md`, `CONTRIBUTING.md` and backlog if present (a local-only backlog may be missing from a worktree: ask where it is or skip it), the `[Unreleased]` section of `CHANGELOG.md`, `package.json` scripts, `opdk.config.*`, the workflows, fixtures, the unit config and test helpers. Read the kit's backlog or issue list, so items already filed are marked KNOWN instead of raised again.

From the kit's docs at the pinned tag, read in full the e2e helpers table, demo stills, presets and checks, the unit options and known mock gaps, and the inputs of the reusable workflows. Skim the build, scanner and release internals.

For specs, grep before reading: fixed sleeps (`waitForTimeout`, `setTimeout`), casts to reach Obsidian internals (`as unknown as`, `globalThis`), `evaluate(` and raw `keyboard.press(`, then read each hit in context. Grep the site and README tooling; do not read it unless a finding points there.

Check the plugin's own claims about the kit against the kit: in the CHANGELOG, the last migration PR's body, and any updated local docs a migration left for the author to apply (diff those against the live file).

## Phase 1: measure

Reading alone misses most picture, coverage and test-isolation findings. Run each once. In zsh, unquoted `$args` do not split: write measurement loops as a bash script or use arrays.

- **Gates, warm.** typecheck, lint, unit with coverage, build, `opdk scan`, `opdk release check`, and every other check the plugin's own CI runs. Time the second run, not the first.
- **Coverage over all of `src`.** Run the unit suite with coverage over every source file and thresholds at 0. A command-line `--coverage.exclude` replaces the config's list, so pass the base excludes (`**/*.test.ts`, `src/test/**`, `**/*.d.ts`) explicitly. Compare the totals with the gate: an exclusion the gate does not need is a finding.
- **Tests type-check.** A scratch tsconfig that includes the test files (with `typeRoots` pointing into the plugin's `node_modules`): count the errors and look for imports that resolve to the built `main.js`, which types the plugin as `any`.
- **Shared-worker runs.** If the suite is slow, time `vitest run --no-isolate`. Then, before calling it safe, run it on ONE worker in default order and with a few shuffled seeds (`--maxWorkers=1 --sequence.shuffle --sequence.seed=N`). On many workers each worker gets a few files and leaks between files hide; CI runners have two to four cores. Report failures, never the speed alone.
- **Pictures.** For every image in the screens, listing and site folders: pixel size (`sips -g pixelWidth -g pixelHeight` or `identify`), a hash for duplicates, and a grep of README, site and listing sources for which files are used. Record who makes each one (a kit `demo.still` or film, a plugin script, a composer that reads other pictures, or nothing in the repo). Find every script that reads the screens folder and what pixel density it assumes. Check each `width`/`height` attribute against its file's aspect ratio (display sizes, not pixel sizes) and each alt text against what the picture shows.
- **Films.** A contact sheet per GIF that always includes the last frame (the loop seam is at the end), and look at it for cut-off modals, a stray cursor, a moving clock, private data and a stale UI:
  ```bash
  N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 film.gif)
  K=$(( (N + 14) / 15 )); LAST=$(( N - 1 ))   # at most 15 frames plus the last fit the 4x4 grid
  ffmpeg -v error -y -i film.gif -vf "select='not(mod(n\,$K))+eq(n\,$LAST)',scale=320:-1,tile=4x4" -fps_mode vfr -frames:v 1 sheet.png
  ```
- **e2e timings.** Do not run e2e, films or `opdk demo` in phase 1. Use the last Playwright report or the migration log; compare wall time with the summed test time (a suite that spends most of its time launching Obsidian is a finding).
- **A second plugin.** A KIT-GENERIC claim needs two plugins. A read-only grep in a sibling plugin checkout is allowed; name the file.

## Phase 1: what to look for

1. **Still hand-made.** Fixed sleeps where `obsidian.settle()` or a wait on what the test asserts fits; own settings, command, editor, IME, mobile, theme or notice helpers next to the e2e helpers; own Obsidian launchers outside the fixture; own DOM polyfills or Vitest config; own scripts next to an `opdk` command; lint rules the kit's preset dropped that the plugin used to enforce.
2. **Pictures and films.** Pictures nothing can retake, at mixed density, with window chrome, on a moving date, showing private data or a stale UI; films that drift from their narration or captions; files nobody embeds; text around a picture (alt, captions, guide steps, generated pages) that describes a screen which no longer exists.
3. **Test gaps.** Files outside the coverage gate, UI the unit mocks or e2e helpers now make testable, untyped or unlinted tests, order-dependent tests, slow or launch-bound specs, specs that do not test what their name says.
4. **Release and CI.** Steps the plugin's workflows or scripts still duplicate, kit workflow inputs it should set, kit pins (tag, lockfile, workflow SHAs) that do not name one commit, a missing Dependabot config.
5. **Kit gaps.** What the plugin needs that the kit lacks, gets wrong or documents wrongly.

## Phase 1: report

One section per module. A module with nothing to report gets one line, not an empty table. Otherwise a table: finding, evidence (file:line or the measured value), proposed change, effort (S/M/L), risk. Mark the findings a user of the plugin would notice.

Triage every finding:
- **KIT**: a kit bug or a false statement in its docs.
- **KIT-GENERIC**: needed by two or more plugins (name them), or plain Obsidian behaviour. A one-plugin case that looks generic is a "KIT-GENERIC candidate".
- **PLUGIN-ONLY**: this plugin's own work.
- **KNOWN**: already in the kit's backlog; give its id, and "now N plugins" when this plugin adds one.

End with numbered questions the author can answer in a word, then either suggested batches (one branch each) or, for an audit only, backlog-ready items (area, size, priority, one line each). Stop there.

## Phase 2: do the chosen items

- One branch per batch, named and titled by the plugin's conventions; every change listed in the plugin's CHANGELOG. Nothing changes silently.
- **Retaken pictures.** Freeze the date (`demo.freezeTime`), keep the composers that read the stills working at the new density, and show a contact sheet, old next to new, before committing; commit pictures only on the author's yes. Name what changes in the look, not only the density (a clean UI may drop a title or widen the content), and check the crop at the edges. In the same branch update every place that describes them: `width`/`height` ratios, alt texts, captions, guide steps, CHANGELOG sizes. Fix generated pages in their generator, then run its check.
- **Shared-worker runs.** Turn `isolate` off only after the one-worker runs above are green; fix the leaks first (mocks of modules another file already loaded, locales, globals, DOM left behind).
- **New tests** must test behaviour: break the code on purpose a few times and report that the tests fail. Restore from a backup copy, never with git.
- **Gates** before each PR: typecheck, lint, unit with the coverage gate, build, `opdk scan`, `opdk release check`, and every check of the plugin's own CI. Run the full e2e once at the end of the batch. In a worktree, check that the e2e config finds sibling plugins it loads (relative paths break there).
- **PRs.** One per batch. Before pushing a follow-up commit, check the PR is still open; if it was merged, the follow-up is a new PR. Merge, tag or release only when the author says so.
- **Directory pictures.** A community directory listing is not updated by a merge. Tell the author which files changed and that the listing needs a manual upload, or do it in the author's signed-in browser only when asked. A site that deploys on a published release needs a manual run to show new pictures before then.

## End of each phase

Phase 1: the report, the questions, the batches or backlog items. Phase 2: branches, PR URLs, gate results, the deliberate failures and how the tests caught them, and what is left for the author (listing upload, site deploy, release, a phone check).
