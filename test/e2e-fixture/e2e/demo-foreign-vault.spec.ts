/**
 * The privacy guard of the `demo` fixture against the real Obsidian: when `OPDK_E2E_VAULT` chose the vault, a film or a
 * still is refused unless the spec says `allowForeignVault: true`. The override points at the kit's own seed vault, so
 * nothing private is at risk; what counts is where the path came from.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createObsidianTest } from "../../../src/e2e/index.js";
import { FIXTURE_ID, SECOND_ID, SEED_VAULT } from "./fixtures.js";

const root = path.join(import.meta.dirname, "..");
const OUT_DIR = path.join(os.tmpdir(), `opdk-demo-foreign-${String(process.pid)}`);

/** The override is read once, when `createObsidianTest` resolves its options, so it is put back at once: later spec files must not see it. */
function withVaultOverride<T>(vault: string, create: () => T): T {
    const previous = process.env.OPDK_E2E_VAULT;
    process.env.OPDK_E2E_VAULT = vault;
    try {
        return create();
    } finally {
        if (previous === undefined) {
            delete process.env.OPDK_E2E_VAULT;
        } else {
            process.env.OPDK_E2E_VAULT = previous;
        }
    }
}

const { test, expect } = withVaultOverride(SEED_VAULT, () =>
    createObsidianTest({
        seedVault: path.join(root, "vault-that-the-override-replaces"),
        plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
        window: { width: 1200, height: 800 },
        demo: { outDir: OUT_DIR },
    }),
);

test.afterAll(() => {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
});

test("a vault from OPDK_E2E_VAULT is refused for films and stills unless the spec allows it", async ({ obsidian, demo }) => {
    await obsidian.openFile("Welcome.md", { mode: "source" });

    expect(() => demo.film({ kind: "desktop", name: "refused" })).toThrow(/film "refused" refused: OPDK_E2E_VAULT points this run at .*Unset OPDK_E2E_VAULT/s);
    await expect(demo.still("refused")).rejects.toThrow(/still "refused" refused: OPDK_E2E_VAULT/);
    expect(fs.existsSync(OUT_DIR)).toBe(false);

    const film = demo.film({ kind: "desktop", name: "allowed", allowForeignVault: true });
    await film.shot({ hold: 1 });
    const still = await demo.still("allowed", { allowForeignVault: true });
    expect(fs.existsSync(path.join(film.dir, "0001.png"))).toBe(true);
    expect(fs.existsSync(still.file)).toBe(true);
});
