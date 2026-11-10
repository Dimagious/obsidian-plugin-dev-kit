import { describe, expect, it } from "vitest";
import { settingsNotOpenedMessage, settingsTabNotFoundMessage } from "./settings.js";

describe("settingsTabNotFoundMessage", () => {
    it("names the tab, the wait and the registered ids", () => {
        const message = settingsTabNotFoundMessage("my-plugin", ["editor", "about", "other"], 15_000);
        expect(message).toContain('No settings tab with id "my-plugin" appeared within 15000 ms.');
        expect(message).toContain("Registered tabs: editor, about, other.");
        expect(message).toContain("manifest.json");
    });

    it("says none when nothing is registered", () => {
        expect(settingsTabNotFoundMessage("x", [], 1)).toContain("Registered tabs: none.");
    });
});

describe("settingsNotOpenedMessage", () => {
    it("names the seed's app.json when the popout is configured", () => {
        const message = settingsNotOpenedMessage({ popoutConfigured: true, windows: 1, timeoutMs: 10_000 });
        expect(message).toContain("settingsPopoutWindow");
        expect(message).toContain("seed vault's app.json");
    });

    it("names the seed's app.json when a second window is open", () => {
        expect(settingsNotOpenedMessage({ popoutConfigured: false, windows: 2, timeoutMs: 10_000 })).toContain("second window");
    });

    it("says what was waited for and which option to raise otherwise", () => {
        const message = settingsNotOpenedMessage({ popoutConfigured: false, windows: 1, timeoutMs: 10_000 });
        expect(message).toContain("within 10000 ms");
        expect(message).toContain("timeouts.helpers.ui");
        expect(message).not.toContain("settingsPopoutWindow");
    });
});
