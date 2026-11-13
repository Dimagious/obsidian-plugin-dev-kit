/**
 * The live checklist of the e2e core. Every test gets its own Obsidian; each one starts right after the fixture
 * resolves, with no waiting of its own, because what the fixture promises is exactly that.
 */
import fs from "node:fs";
import type { AppWithInternals, PluginInstance } from "../../../src/e2e/index.js";
import { expect, FIXTURE_ID, SECOND_ID, SEEDED_GREETING, SEED_VAULT, test } from "./fixtures.js";

/** The fixture plugin as the spec reads it. */
type FixtureApp = AppWithInternals<PluginInstance & { settings?: { greeting?: string } }>;

const TRUST_BUTTON = "Trust author and enable plugins";

test("opens the vault without the trust dialog and without the vault picker", async ({ win, app, vault }) => {
    // The trust dialog appears 0.3 to 1.1 s after the workspace exists; this is how long we look for it.
    await win.waitForTimeout(2_000);
    await expect(win.getByRole("button", { name: TRUST_BUTTON })).toHaveCount(0);
    expect(app.windows()).toHaveLength(1);
    expect(win.url()).not.toContain("starter");
    const basePath = await win.evaluate(() => (globalThis as unknown as { app: AppWithInternals }).app.vault.adapter.basePath);
    expect(fs.realpathSync(basePath)).toBe(fs.realpathSync(vault.path));
    expect(vault.path).not.toBe(SEED_VAULT);
    expect(vault.read("Welcome.md")).toContain("# Welcome");
});

test("both plugins are loaded, and what onload registered after an await is there right away", async ({ win }) => {
    const state = await win.evaluate(
        (ids) => {
            const { app } = globalThis as unknown as { app: AppWithInternals };
            return {
                loaded: ids.map((id) => app.plugins.plugins[id] !== undefined),
                enabled: ids.map((id) => app.plugins.enabledPlugins.has(id)),
                loadingPluginId: app.plugins.loadingPluginId,
                commands: Object.keys(app.commands.commands).filter((id) => id.startsWith("opdk-e2e-")),
                tabs: app.setting.pluginTabs.map((tab) => tab.id),
            };
        },
        [FIXTURE_ID, SECOND_ID],
    );
    expect(state.loaded).toEqual([true, true]);
    expect(state.enabled).toEqual([true, true]);
    expect(state.loadingPluginId).toBeNull();
    // The fixture plugin registers this 300 ms after onload() starts.
    expect(state.commands).toEqual(expect.arrayContaining([`${FIXTURE_ID}:late-command`, `${SECOND_ID}:ping`]));
    expect(state.tabs).toContain(FIXTURE_ID);
});

test("the settings open in the main window, not in a popout", async ({ win, app }) => {
    await win.evaluate((id) => {
        const { app: obsidian } = globalThis as unknown as { app: AppWithInternals };
        obsidian.setting.open();
        obsidian.setting.openTabById(id);
    }, FIXTURE_ID);
    await expect(win.locator(".modal.mod-settings")).toBeVisible();
    await expect(win.locator(".vertical-tab-content").getByText("Settings tab registered after an await in onload().")).toBeVisible();
    expect(app.windows()).toHaveLength(1);
});

test("the report carries the Obsidian version and the launch mode", ({ app }, testInfo) => {
    expect(app.windows()).toHaveLength(1);
    const byType = new Map(testInfo.annotations.map((annotation) => [annotation.type, annotation.description]));
    expect(byType.get("obsidian-version")).toMatch(/^\d+\.\d+\.\d+/);
    expect(byType.get("launch-mode")).toBe("electron");
    // Launch to ready: the reporter's test duration leaves this out, the note carries it.
    expect(Number(byType.get("obsidian-launch-ms"))).toBeGreaterThan(0);
});

test("window.confirm() does not hang the test", async ({ win }) => {
    const answer = await win.evaluate(() => (globalThis as unknown as { confirm(message: string): boolean }).confirm("Proceed?"));
    expect(answer).toBe(false);
});

test("data.json is seeded and the plugin read it", async ({ win, vault }) => {
    expect(JSON.parse(vault.read(`.obsidian/plugins/${FIXTURE_ID}/data.json`))).toEqual({ greeting: SEEDED_GREETING });
    const greeting = await win.evaluate(
        (id) => (globalThis as unknown as { app: FixtureApp }).app.plugins.plugins[id]?.settings?.greeting,
        FIXTURE_ID,
    );
    expect(greeting).toBe(SEEDED_GREETING);
});

test("a test cannot touch the seed vault", ({ vault }) => {
    vault.write("scratch.md", "only in the copy");
    expect(fs.existsSync(`${SEED_VAULT}/scratch.md`)).toBe(false);
});
