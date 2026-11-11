import { describe, expect, it } from "vitest";
import { parseDemoArgs } from "./args.js";

describe("parseDemoArgs", () => {
    it("takes no names to mean all films", () => {
        expect(parseDemoArgs([])).toEqual({ names: [] });
    });

    it("collects film names once each, in order", () => {
        expect(parseDemoArgs(["tour-light", "tour-dark", "tour-light"])).toEqual({ names: ["tour-light", "tour-dark"] });
    });

    it("rejects an option, so a mistyped flag is not taken for a film name", () => {
        expect(() => parseDemoArgs(["--fast"])).toThrow('"opdk demo" has no option "--fast"');
        expect(() => parseDemoArgs(["tour", "-x"])).toThrow(/no option "-x"/);
    });
});
