import { describe, expect, it } from "vitest";
import { parseUpgradeArgs } from "./args.js";

describe("parseUpgradeArgs", () => {
    it("takes no tag as the latest release", () => {
        expect(parseUpgradeArgs([])).toEqual({ target: undefined, dryRun: false });
    });

    it("accepts a tag with or without the v, and --dry-run in any place", () => {
        expect(parseUpgradeArgs(["v0.2.0"])).toEqual({ target: "v0.2.0", dryRun: false });
        expect(parseUpgradeArgs(["--dry-run", "0.2.0"])).toEqual({ target: "v0.2.0", dryRun: true });
    });

    it("refuses other text, a second tag and unknown options", () => {
        expect(() => parseUpgradeArgs(["latest"])).toThrow(/"latest" is not a kit release tag/);
        expect(() => parseUpgradeArgs(["v0.2.0", "v0.3.0"])).toThrow(/one is enough/);
        expect(() => parseUpgradeArgs(["--force"])).toThrow('Unknown option "--force"');
        expect(() => parseUpgradeArgs(["v0.2"])).toThrow(/not a kit release tag/);
    });
});
