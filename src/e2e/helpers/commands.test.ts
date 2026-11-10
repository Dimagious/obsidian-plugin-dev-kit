import { describe, expect, it } from "vitest";
import { closeCommandIds, commandDeclinedMessage, commandNotFoundMessage, toPlaywrightKeys } from "./commands.js";

const IDS = ["editor:toggle-bold", "editor:toggle-italics", "app:open-settings", "my-plugin:late-command", "my-plugin:ping", "other:ping"];

describe("closeCommandIds", () => {
    it("finds a one-letter typo", () => {
        expect(closeCommandIds("my-plugin:late-comand", IDS)).toEqual(["my-plugin:late-command"]);
    });

    it("finds ids that contain what was typed, and lists the closest first", () => {
        expect(closeCommandIds("ping", IDS)).toEqual(["my-plugin:ping", "other:ping"]);
    });

    it("finds an id by the part after the plugin prefix being wrong", () => {
        expect(closeCommandIds("editor:toggle-bld", IDS)).toContain("editor:toggle-bold");
    });

    it("is case-insensitive", () => {
        expect(closeCommandIds("APP:OPEN-SETTINGS", IDS)).toEqual(["app:open-settings"]);
    });

    it("returns nothing for something unrelated, and for an empty registry", () => {
        expect(closeCommandIds("zzzzzzzzzzzz", IDS)).toEqual([]);
        expect(closeCommandIds("anything", [])).toEqual([]);
    });

    it("lists at most five", () => {
        const many = Array.from({ length: 12 }, (_unused, index) => `plugin:cmd-${String(index)}`);
        expect(closeCommandIds("cmd", many)).toHaveLength(5);
    });
});

describe("commandNotFoundMessage", () => {
    it("names the id and the close matches, and says what an id looks like", () => {
        const message = commandNotFoundMessage("my-plugin:late-comand", IDS);
        expect(message).toContain('Command "my-plugin:late-comand" does not exist.');
        expect(message).toContain("Close matches: my-plugin:late-command.");
        expect(message).toContain("<plugin id>:<command id>");
    });

    it("says so when nothing is similar, with the number of commands", () => {
        expect(commandNotFoundMessage("zzzzzzzzzzzz", IDS)).toContain("No registered id is similar (6 commands are registered).");
    });
});

describe("commandDeclinedMessage", () => {
    it("names the command and the usual cause", () => {
        const message = commandDeclinedMessage("editor:toggle-bold");
        expect(message).toContain('"editor:toggle-bold" exists but did not run');
        expect(message).toContain("focused editor");
    });
});

describe("toPlaywrightKeys", () => {
    it("maps Mod to ControlOrMeta", () => {
        expect(toPlaywrightKeys("Mod+P")).toBe("ControlOrMeta+P");
        expect(toPlaywrightKeys("Mod+Shift+P")).toBe("ControlOrMeta+Shift+P");
        expect(toPlaywrightKeys("Shift+Mod+Enter")).toBe("Shift+ControlOrMeta+Enter");
        expect(toPlaywrightKeys("mod+a")).toBe("ControlOrMeta+a");
    });

    it("keeps a plus key after Mod", () => {
        expect(toPlaywrightKeys("Mod++")).toBe("ControlOrMeta++");
    });

    it("leaves everything else alone, including keys that merely contain Mod", () => {
        expect(toPlaywrightKeys("Escape")).toBe("Escape");
        expect(toPlaywrightKeys("Control+A")).toBe("Control+A");
        expect(toPlaywrightKeys("Modal")).toBe("Modal");
    });

    it("refuses an empty combination", () => {
        expect(() => toPlaywrightKeys("")).toThrow("press() needs a key");
        expect(() => toPlaywrightKeys("  ")).toThrow("press() needs a key");
    });
});
