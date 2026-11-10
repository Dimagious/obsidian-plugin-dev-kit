/**
 * The kit's own e2e smoke: `npm run e2e:smoke`. It starts the real Obsidian on a throwaway copy of `vault/` with the
 * two prebuilt plugins in `plugins/`, so it opens windows: run it by hand, never from `npm test` or CI.
 *
 * It runs on the Electron in this repository's devDependencies and the Obsidian app.asar of the machine
 * (`OBSIDIAN_PATH` to point somewhere else, `OBSIDIAN_VERSION` to pin the version).
 */
import { defineObsidianConfig } from "../../src/e2e/index.js";

export default defineObsidianConfig({
    // Fails the run when it leaves an opdk-e2e-* folder or an Obsidian process behind.
    globalSetup: "./leftovers.ts",
});
