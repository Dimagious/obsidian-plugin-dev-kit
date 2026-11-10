import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry.js";
import type { Command } from "./types.js";

const make = (name: string): Command => ({
    name,
    summary: "s",
    usage: "u",
    run: () => Promise.resolve(0),
});

describe("createRegistry", () => {
    it("returns an empty registry for no commands", () => {
        expect(createRegistry([]).size).toBe(0);
    });

    it("looks commands up by name", () => {
        const build = make("build");
        expect(createRegistry([build, make("lint-scan")]).get("build")).toBe(build);
    });

    it("does not resolve inherited object keys", () => {
        expect(createRegistry([make("build")]).get("constructor")).toBeUndefined();
    });

    it("rejects duplicate names", () => {
        expect(() => createRegistry([make("build"), make("build")])).toThrow('Command "build" is registered twice');
    });

    it.each(["", "Build", "1build", "bu ild", "-x"])("rejects the invalid name %j", (name) => {
        expect(() => createRegistry([make(name)])).toThrow("Invalid command name");
    });
});
