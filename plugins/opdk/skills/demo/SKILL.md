---
name: demo
description: Make a demo film, GIF, MP4, poster or README and listing screenshot of an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk) with `opdk demo` and the `demo` fixture (`demo.film`, `film.shot`, `demo.still`, `demo.caption`, `demo.cleanUi`, `demo.themes`). Use it to film a feature, record a phone layout, capture themed stills, fix `opdk demo` messages ("no films", "refused", "forbidden selector", "loop does not close", "not found on PATH", "libx264"), or to replace a plugin's own capture scripts. Not for ordinary Playwright tests (e2e).
---

# opdk demo module

A film is a list of stills: each `film.shot()` freezes the Obsidian window and takes a picture at 2x, with a hold in seconds and an optional caption. `opdk demo` encodes the film to `<name>.mp4`, `<name>.gif` and `<name>-poster.png`. No audio, no intro or outro cards. Run commands from the plugin root. Full docs: https://github.com/Dimagious/obsidian-plugin-dev-kit/blob/main/docs/demo.md

Safety: specs run in a temp copy of the seed vault. When you run anything that writes into a vault (`opdk build --vault`), use `env -u VAULT_PLUGIN`. Never film a vault that is not the plugin's own seed vault.

## Plan a film

1. Write down 2 to 4 steps, each one a state of the app (open a note, type, run a command, open settings). One idea per step.
2. Rehearse the selectors and commands in a plain e2e spec first (`obsidian.*` helpers, see the e2e skill) and assert each state. A film spec should have no surprises left.
3. Choose the kind: `phone` (inside `obsidian.mobile()`, with `captions` for the `phone-captions` layout) or `desktop` (with `demo.caption()` bars, or no captions).
4. Pace: 2 to 4 seconds per step, a longer hold on the first and the last frame. For typing, shoot every few characters with a hold of 0.4 to 0.6 s and finish with a longer one; 25 to 40 ms per character (`typeSlowly` default is 40). A caption stays under about 60 characters; a line break (`"Tap a day\nSee its value"`) makes a heading and a text in the phone layout.
5. End where you began (same note, same text, same focus) so the GIF loops without a jump. Hide the caption (`demo.caption(null)`) and the cursor before the last shot so it matches the first; a tour that cannot return to its start gets `loop: "off"`.
6. A frame that shows network content (a page that loads data at run time) differs between takes. Replace the plugin's fetching function with `obsidian.replace()` and a fixture so the film is stable.

## Privacy rules

- Seed vault inside the plugin folder, made for the film. Never `OPDK_E2E_VAULT` pointing at a real vault. The fixture refuses both (`film "<name>" refused: ...`) unless the call passes `allowForeignVault: true`; do not pass it for a real vault.
- Put every selector that could show private data (an API key field, an account name, a path) in `demo.forbiddenSelectors`; a shot fails when one is visible.
- `demo.freezeTime("2026-03-14T09:26:00")` so no frame shows today's date. File dates in the explorer are not frozen.
- `.opdk/` goes in `.gitignore`: it holds raw frames.

## Destinations and sizes

- README GIF: GitHub shows a README at about 1000 px, and 900 is the kit's own choice, under 2 MB (`gif: { width: 900 }`; the default is the frame width up to 1000 px, 128 colours, 10 fps at most). The size check warns above 2 MB and fails above 10 MB.
- Stills for other places (`demo.still(name, { preset })`): `readme` 1000 x 640, `listing-desktop` 1200 x 800, `listing-phone` 900 x 1600, `social` 1200 x 630. `opdk demo` copies every `<outDir>/stills/<name>.png` to the output folder as `<name>.png`, only when the bytes changed (`demo.stills: false` turns it off, `demo.stills: { output }` picks a folder); `opdk demo hero` selects the still `hero` as well as a film of that name.
- Frames are shot at scale 2 (a 1200 x 800 window gives 2400 x 1600, a phone gives 780 x 1688). The MP4 and poster keep the frame size, the GIF is smaller.

## The recording API

```ts
import { expect, onlyWhen, test } from "./fixtures.js";

onlyWhen("OPDK_E2E_FILM");

test("tour: open a note, type, run a command", async ({ obsidian, demo, win }) => {
    await demo.freezeTime("2026-03-14T09:26:00");
    await obsidian.mobile();
    await obsidian.openFile("Welcome.md", { mode: "source" });
    await demo.cleanUi();
    await obsidian.clearNotices();
    const film = demo.film({ name: "tour", kind: "phone", captions: ["Open a note", "Type\nKey by key", "Run a command"] });
    await film.shot({ hold: 1.8, caption: 0 });
    const editor = win.locator(".cm-content[contenteditable=true]").first();
    await demo.tap(editor);
    await demo.typeSlowly("# Typed by the kit", { delayMs: 40 });
    await expect(editor).toContainText("Typed by the kit");
    await film.shot({ hold: 1.6, caption: 1 });
    await obsidian.runCommand("my-plugin:insert-date");
    await film.shot({ hold: 1.6, caption: 2 });
});
```

- `demo.film({ kind, name?, fps?, captions?, clip?, padding?, scale?, cursor?, forbiddenSelectors?, allowForeignVault? })`; the folder is emptied at the start, so a retake replaces the frames. `film.shot({ hold, caption?, clip?, padding?, settle? })`: assert the state first, a shot does not wait for the app. `settle: true` (also in `demo.still()`, default `false`) waits for the page to stop changing before the freeze: use it instead of a `waitForTimeout` (a pause longer than `quietMs` before the render looks settled, so assert on the element or raise `quietMs`).
- `demo.tap(target, { whilePressed? })` on a phone, `demo.moveAndClick(target)` on the desktop; `demo.typeSlowly(text)` types into the focused element (fails when nothing editable has focus), `demo.typeSlowly(target, text)` clicks the target first. `demo.caption(text | null)` is a bar drawn into the frames; `captions` in `film()` is the list the phone layout draws beside the phone. `demo.hideCursor()`. The cursor arrow follows every Playwright mouse action (`click()`, `check()`, `selectOption()`), not only `moveAndClick()`; `cursor: false` in `demo.film()` or `demo.still()` keeps it out of that film's frames or that still (it does not carry over to the next picture).
- `demo.beat(seconds)` is seconds (not milliseconds, throws above 60) and is for pacing a Playwright video of a test; the kit films stills only, so use `hold`.
- `demo.cleanUi(options?)` (each call sets the five hidden parts: ribbon, statusBar, tabHeaders, viewHeader, inlineTitle; it also folds both sidebars, `sidebars: false` keeps them), `demo.freezeTime(date)`, `demo.themes(["light", "dark"], scene)` (names get `-light` and `-dark`).
- Fixture option: `createObsidianTest({ demo: { outDir, scale, forbiddenSelectors } })`.

## Encode

`opdk.config.mjs`, `demo` section (all optional): `outDir` (`.opdk/demo`), `output` (`docs/screens`), `gif`, `mp4`, `poster`, `stills` (`true`, `false` or `{ output }`), `layout` (`"plain"` or `"phone-captions"`), `budget`, `loop`, `phone`, and `films.<name>` with the same film keys. Then:

```bash
OPDK_E2E_FILM=1 npx playwright test film   # records
npx opdk demo [names...]                   # encodes every complete film, copies the stills
```

`opdk demo` needs ffmpeg for films (on `PATH` or `OPDK_FFMPEG`). The phone layout also needs `electron` and `@playwright/test`, as the e2e tests do; in CI add ffmpeg, a virtual display (`xvfb-run -a`) and `OPDK_COMPOSE_NO_SANDBOX=1`.

## Reading failures

- `no films in <dir>/films`: the specs did not run or wrote elsewhere. Run the gated spec, or set `demo.outDir`.
- `no film named "x" in ...` (`no film or still named` when stills exist) `in <outDir>`: the message lists the films and stills there; fix the name. With `stills: false` it adds `demo.stills is false, so stills are not selectable` when the name is a still on disk.
- `<name>: skipped, <reason>` or `not encoded`: the recording test did not pass, so the film is incomplete. Fix the test, record again.
- `film "x" refused: OPDK_E2E_VAULT points this run at ...`: unset `OPDK_E2E_VAULT`. `... the seed vault ... lies outside the plugin folder`: move the seed vault into the plugin folder. Do not reach for `allowForeignVault` to make it pass.
- `film "x", frame N refused: an element matching the forbidden selector`: close or hide the element before the shot.
- `OPDK_FFMPEG=... cannot run` or `ffmpeg was not found on PATH`: install ffmpeg (`brew install ffmpeg`), or point `OPDK_FFMPEG` at it. `has no libx264 encoder`: install a full ffmpeg or set `mp4: false`.
- `ffmpeg exited with code 0 but reported errors`: a frame could not be decoded; the film fails, record it again.
- `gif is N MB, over the 10.0 MB limit`: lower `gif.width`, `colors` or `fps`, or shorten the film; the file stays in the output folder.
- `! loop does not close: the last frame differs from the first in a W x H px area at (x, y)`: end the scene where it began (hide the caption and the cursor in the last frame), or set `loop: "off"` for a tour. Pixels within 8 of 255 per channel already count as equal.
- `! frame 0003.png (0.05 s) is held for less than one GIF frame`: hold it at least 0.1 s, or raise `gif.fps`.
- `! the dark film "x-dark" is missing`: record both themes, or encode with the pair's name.
- `! media published by an earlier run of this command belongs to films or stills that no longer exist: ...`: files `opdk demo` itself wrote (recorded in `<outDir>/published.json`) for a film or still that was renamed or removed; the command never deletes, so delete them by hand. Unrelated media in the output folder is never listed.
- `! media published by an earlier run of this command is no longer written by its film or still (an output turned off, or moved): ...`: recorded files of a film or still that still exists and was written without a failure this run but not these files (for example after `mp4: false`, a new `demo.output` or `demo.stills.output`). Delete them by hand.
- `settle` does not see canvas drawing (charts): before a still of a canvas, poll a pixel or the chart library's ready flag yourself.
- `settle(): the page was not quiet for N ms within M ms (...)`: something keeps changing the DOM, a font or an image in view is slow. Pass `settle` only where the page can be still, call `obsidian.settle({ root })` with a `root` that leaves out a part that never stops changing, or raise `timeouts.helpers.ui`.
- `layout "phone-captions" ... has none` / `is for phone films`: pass `captions` to `demo.film()`, and use `kind: "phone"`.
- `... must be a CSS value without "..."`: a `phone` colour or font holds `; { } < > \ /* url(` or quotes; use a plain value.

## Migrating a plugin's own scripts

1. Add the kit, `@playwright/test`, `electron` and ffmpeg; add `.opdk/` to `.gitignore`. To move the kit to a new tag use `npm install -D "github:Dimagious/obsidian-plugin-dev-kit#<tag>"`: editing `package.json` and running a plain `npm install` keeps the old lock entry.
2. Rewrite the film and capture specs on `demo` (films of stills in place of screen recordings and screenshot loops).
3. Move README and listing pictures from `win.screenshot` to `demo.still(name, { preset, settle: true })` (and their sleeps to `settle`; a pause longer than `quietMs` before the render looks settled, so assert on the element or raise `quietMs`), then GIF numbers to `gif` per film, the poster and output names are `<name>-poster.png` and `docs/screens` (to keep a `film-<name>-poster.png`, name the film `film-<name>`; a phone film with captions beside it uses `layout: "phone-captions"` with the colours in `phone`; voice-over and an outro are not part of the kit).
4. Delete the old encoder scripts, run the specs and `opdk demo`, compare, and list the differences in the plugin's CHANGELOG. `beat()` takes seconds now.
