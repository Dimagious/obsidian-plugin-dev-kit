---
name: demo
description: Use when making a demo film, GIF, MP4, poster or README/listing screenshot of an Obsidian plugin that uses obsidian-plugin-dev-kit (opdk), when writing a spec with the `demo` fixture (`demo.film`, `film.shot`, `demo.still`, `demo.tap`, `demo.typeSlowly`, `demo.caption`, `demo.cleanUi`, `demo.freezeTime`, `demo.themes`), when `opdk demo` fails or warns ("no films", "refused", "forbidden selector", "loop does not close", "held for less than one GIF frame", "not found on PATH", "libx264"), or when migrating a plugin's own capture or film scripts to the kit.
---

# opdk demo module

A film is a list of stills: each `film.shot()` freezes the Obsidian window and takes a picture at 2x, with a hold in seconds and an optional caption. `opdk demo` encodes the film to `<name>.mp4`, `<name>.gif` and `<name>-poster.png`. No audio, no intro or outro cards. Run commands from the plugin root. Full docs: https://github.com/Dimagious/obsidian-plugin-dev-kit/blob/main/docs/demo.md

Safety: specs run in a temp copy of the seed vault. When you run anything that writes into a vault (`opdk build --vault`), use `env -u VAULT_PLUGIN`. Never film a vault that is not the plugin's own seed vault.

## Plan a film

1. Write down 2 to 4 steps, each one a state of the app (open a note, type, run a command, open settings). One idea per step.
2. Rehearse the selectors and commands in a plain e2e spec first (`obsidian.*` helpers, see the e2e skill) and assert each state. A film spec should have no surprises left.
3. Choose the kind: `phone` (inside `obsidian.mobile()`, with `captions` for the `phone-captions` layout) or `desktop` (with `demo.caption()` bars, or no captions).
4. Pace: 2 to 4 seconds per step, a longer hold on the first and the last frame. For typing, shoot every few characters with a hold of 0.4 to 0.6 s and finish with a longer one; 25 to 40 ms per character (`typeSlowly` default is 40). A caption stays under about 60 characters; a line break (`"Tap a day\nSee its value"`) makes a heading and a text in the phone layout.
5. End where you began (same note, same text, same focus) so the GIF loops without a jump.

## Privacy rules

- Seed vault inside the plugin folder, made for the film. Never `OPDK_E2E_VAULT` pointing at a real vault. The fixture refuses both (`film "<name>" refused: ...`) unless the call passes `allowForeignVault: true`; do not pass it for a real vault.
- Put every selector that could show private data (an API key field, an account name, a path) in `demo.forbiddenSelectors`; a shot fails when one is visible.
- `demo.freezeTime("2026-03-14T09:26:00")` so no frame shows today's date. File dates in the explorer are not frozen.
- `.opdk/` goes in `.gitignore`: it holds raw frames.

## Destinations and sizes

- README GIF: GitHub shows a README at about 1000 px, and 900 is the kit's own choice, under 2 MB (`gif: { width: 900 }`; the default is the frame width up to 1000 px, 128 colours, 10 fps at most). The size check warns above 2 MB and fails above 10 MB.
- Stills for other places (`demo.still(name, { preset })`): `readme` 1000 x 640, `listing-desktop` 1200 x 800, `listing-phone` 900 x 1600, `social` 1200 x 630. Stills stay in `<outDir>/stills/`; `opdk demo` does not copy them.
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

- `demo.film({ kind, name?, fps?, captions?, clip?, padding?, scale?, forbiddenSelectors?, allowForeignVault? })`; the folder is emptied at the start, so a retake replaces the frames. `film.shot({ hold, caption?, clip?, padding? })`: assert the state first, a shot does not wait for the app.
- `demo.tap(target, { whilePressed? })` on a phone, `demo.moveAndClick(target)` on the desktop; `demo.typeSlowly(text)` types into the focused element (fails when nothing editable has focus), `demo.typeSlowly(target, text)` clicks the target first. `demo.caption(text | null)` is a bar drawn into the frames; `captions` in `film()` is the list the phone layout draws beside the phone. `demo.hideCursor()`.
- `demo.beat(seconds)` is seconds (not milliseconds, throws above 60) and is for pacing a Playwright video of a test; the kit films stills only, so use `hold`.
- `demo.cleanUi(options?)` (each call sets all five parts), `demo.freezeTime(date)`, `demo.themes(["light", "dark"], scene)` (names get `-light` and `-dark`).
- Fixture option: `createObsidianTest({ demo: { outDir, scale, forbiddenSelectors } })`.

## Encode

`opdk.config.mjs`, `demo` section (all optional): `outDir` (`.opdk/demo`), `output` (`docs/screens`), `gif`, `mp4`, `poster`, `layout` (`"plain"` or `"phone-captions"`), `budget`, `loop`, `phone`, and `films.<name>` with the same film keys. Then:

```bash
OPDK_E2E_FILM=1 npx playwright test film   # records
npx opdk demo [names...]                   # encodes every complete film
```

`opdk demo` needs ffmpeg (on `PATH` or `OPDK_FFMPEG`). The phone layout also needs `electron` and `@playwright/test`, as the e2e tests do; in CI add ffmpeg, a virtual display (`xvfb-run -a`) and `OPDK_COMPOSE_NO_SANDBOX=1`.

## Reading failures

- `no films in <dir>/films`: the specs did not run or wrote elsewhere. Run the gated spec, or set `demo.outDir`.
- `no film named "x" in ...`: the message lists the films there; fix the name.
- `<name>: skipped, <reason>` or `not encoded`: the recording test did not pass, so the film is incomplete. Fix the test, record again.
- `film "x" refused: OPDK_E2E_VAULT points this run at ...`: unset `OPDK_E2E_VAULT`. `... the seed vault ... lies outside the plugin folder`: move the seed vault into the plugin folder. Do not reach for `allowForeignVault` to make it pass.
- `film "x", frame N refused: an element matching the forbidden selector`: close or hide the element before the shot.
- `OPDK_FFMPEG=... cannot run` or `ffmpeg was not found on PATH`: install ffmpeg (`brew install ffmpeg`), or point `OPDK_FFMPEG` at it. `has no libx264 encoder`: install a full ffmpeg or set `mp4: false`.
- `ffmpeg exited with code 0 but reported errors`: a frame could not be decoded; the film fails, record it again.
- `gif is N MB, over the 10.0 MB limit`: lower `gif.width`, `colors` or `fps`, or shorten the film; the file stays in the output folder.
- `! loop does not close: the last frame differs from the first in a W x H px area at (x, y)`: end the scene where it began, or set `loop: "off"` for a difference nobody sees.
- `! frame 0003.png (0.05 s) is held for less than one GIF frame`: hold it at least 0.1 s, or raise `gif.fps`.
- `! the dark film "x-dark" is missing`: record both themes, or encode with the pair's name.
- `! ... holds media of films that no longer exist`: the output folder has media with no film behind it, often unrelated GIFs; the command never deletes, so delete it by hand or ignore it.
- `layout "phone-captions" ... has none` / `is for phone films`: pass `captions` to `demo.film()`, and use `kind: "phone"`.
- `... must be a CSS value without "..."`: a `phone` colour or font holds `; { } < > \ /* url(` or quotes; use a plain value.

## Migrating a plugin's own scripts

1. Add the kit, `@playwright/test`, `electron` and ffmpeg; add `.opdk/` to `.gitignore`.
2. Rewrite the film and capture specs on `demo` (films of stills in place of screen recordings and screenshot loops).
3. Move GIF numbers to `gif` per film, the poster and output names are `<name>-poster.png` and `docs/screens` (Garmy: name the film `film-<name>` to keep `film-<name>-poster.png`; Dashy's phone film uses `layout: "phone-captions"` with the colours in `phone`; Snipsy's voice-over and outro are not part of the kit).
4. Delete the old encoder scripts, run the specs and `opdk demo`, compare, and list the differences in the plugin's CHANGELOG. `beat()` takes seconds now.
