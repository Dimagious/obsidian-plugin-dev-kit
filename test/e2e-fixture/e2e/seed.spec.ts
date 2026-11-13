/**
 * The live check of `test.use({ seed })`: the files and settings are in the vault Obsidian opens, with no reload.
 */
import { expect, test } from "./fixtures.js";

test.describe("seeded vault", () => {
    test.use({
        seed: {
            files: { "Seeded/Note.md": "# Seeded note\n\nwritten before the start\n", ".obsidian/templates.json": '{"folder":"Templates"}' },
            config: { propertiesInDocument: "hidden" },
        },
    });

    test("Obsidian indexes the seeded note and reads the seeded setting at start", async ({ obsidian, vault }) => {
        expect(vault.read("Seeded/Note.md")).toContain("written before the start");
        await obsidian.waitForMetadataCache();
        const found = await obsidian.evaluate((app: { vault: { getAbstractFileByPath(path: string): unknown; getConfig(key: string): unknown } }) => ({
            note: app.vault.getAbstractFileByPath("Seeded/Note.md") !== null,
            welcome: app.vault.getAbstractFileByPath("Welcome.md") !== null,
            properties: app.vault.getConfig("propertiesInDocument"),
        }));
        expect(found).toEqual({ note: true, welcome: true, properties: "hidden" });
    });
});

test("a test without a seed gets the seed vault as it is", async ({ obsidian, vault }) => {
    expect(vault.exists("Seeded/Note.md")).toBe(false);
    const properties = await obsidian.evaluate((app: { vault: { getConfig(key: string): unknown } }) => app.vault.getConfig("propertiesInDocument"));
    expect(properties).not.toBe("hidden");
});
