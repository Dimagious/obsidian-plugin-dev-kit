import { describe, expect, it } from "vitest";
import { ciRequiresTools, hasTool, realToolsGate } from "./ffmpeg-gate.js";

describe("ciRequiresTools", () => {
    it("is true when CI is set to something other than empty, 0 or false", () => {
        expect(ciRequiresTools({ CI: "true" })).toBe(true);
        expect(ciRequiresTools({ CI: "1" })).toBe(true);
    });

    it("is false locally", () => {
        expect(ciRequiresTools({})).toBe(false);
        expect(ciRequiresTools({ CI: "" })).toBe(false);
        expect(ciRequiresTools({ CI: "0" })).toBe(false);
        expect(ciRequiresTools({ CI: "False" })).toBe(false);
    });
});

describe("realToolsGate", () => {
    it("skips, and says so in the title, only without the tools and outside CI", () => {
        expect(realToolsGate("encodes", false, {})).toEqual({
            skip: true,
            title: "encodes (skipped: ffmpeg and ffprobe are not installed on this machine)",
        });
    });

    it("does not skip, and keeps the plain title, when the tools are there", () => {
        expect(realToolsGate("encodes", true, {})).toEqual({ skip: false, title: "encodes" });
    });

    it("does not skip on CI without the tools: the tests run and fail", () => {
        expect(realToolsGate("encodes", false, { CI: "true" })).toEqual({ skip: false, title: "encodes" });
    });
});

describe("hasTool", () => {
    it("runs a command that exists and reports one that does not", () => {
        expect(hasTool(process.execPath, ["--version"])).toBe(true);
        expect(hasTool("opdk-no-such-tool")).toBe(false);
    });
});
