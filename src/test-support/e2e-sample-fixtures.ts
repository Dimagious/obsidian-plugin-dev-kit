/**
 * What a plugin's `e2e/fixtures.ts`, `e2e/*.spec.ts` and `playwright.config.ts` look like. Nothing imports this
 * file: `npm run typecheck` compiles it, so a change to the public e2e API that breaks a plugin breaks the kit's
 * own typecheck first. Each `@ts-expect-error` line must keep failing to compile.
 */
import { createObsidianTest, defineObsidianConfig } from "../e2e/index.js";

export const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: "e2e/vault",
    plugins: [{ dir: "." }, { dir: "../dashsidian", staleBuildCheck: true }],
    data: { garmidian: { units: "metric", language: "en" } },
    window: { width: 1200, height: 1500 },
    obsidianPath: "/Applications/Obsidian.app/Contents/Resources/app.asar",
    electronArgs: ["--use-mock-keychain"],
    version: "1.14.5",
    timeouts: { launch: 60_000, ready: 45_000, close: 5_000, helpers: { metadataCache: 90_000, ui: 15_000 } },
    staleBuildCheck: true,
    sweepAfterHours: 4,
});

export default defineObsidianConfig({ workers: 1 });

onlyWhen("CAPTURE");

test("sample spec uses win, app and vault", async ({ win, app, vault }) => {
    const title: string = await win.title();
    const windowCount: number = app.windows().length;
    vault.write("notes/a.md", "hello");
    const text: string = vault.read("notes/a.md");
    const present: boolean = vault.exists("notes/a.md");
    const absolute: string = vault.path;
    await expect(win.locator(".workspace")).toBeVisible();
    expect([title, windowCount, text, present, absolute]).toHaveLength(5);
});

test("evaluate is typed by the caller", async ({ obsidian }) => {
    interface SampleApp {
        vault: { getName(): string };
    }
    const name: string = await obsidian.evaluate((app: SampleApp) => app.vault.getName());
    const count: number = await obsidian.evaluate((_app: SampleApp, items: string[]) => Promise.resolve(items.length), ["a"]);
    // @ts-expect-error the argument must match the function's second parameter
    await obsidian.evaluate((_app: SampleApp, items: string[]) => items.length, 3);
    // @ts-expect-error a function with a second parameter needs the argument
    await obsidian.evaluate((_app: SampleApp, items: string[]) => items.length);
    // The factory of replace() follows the same rule.
    await obsidian.replace("my-plugin", "client.fetch", () => () => 1);
    await obsidian.replace("my-plugin", "client.fetch", (days: number) => () => days, 7);
    // @ts-expect-error a factory with a parameter needs the argument
    await obsidian.replace("my-plugin", "client.fetch", (days: number) => () => days);
    // @ts-expect-error the argument must match the factory's parameter
    await obsidian.replace("my-plugin", "client.fetch", (days: number) => () => days, "7");
    expect([name, count]).toHaveLength(2);
});

// @ts-expect-error a plugin entry's staleBuildCheck is a boolean
createObsidianTest({ seedVault: "v", plugins: [{ dir: ".", staleBuildCheck: "no" }] });

// @ts-expect-error seedVault is required
createObsidianTest({});

// @ts-expect-error unknown option
createObsidianTest({ seedVault: "v", seedvault: "v" });

// @ts-expect-error window needs both sizes
createObsidianTest({ seedVault: "v", window: { width: 100 } });

// @ts-expect-error data is keyed by plugin id and holds objects
createObsidianTest({ seedVault: "v", data: { id: "string" } });

test("bad usage", ({ vault }) => {
    // @ts-expect-error vault.read takes a vault-relative path
    vault.read(3);
});

// @ts-expect-error not a fixture
test("bad fixture", ({ browser2 }) => browser2);

// @ts-expect-error the internal session fixture is not part of the public type
test("internal fixture", ({ opdkSession }) => opdkSession);
