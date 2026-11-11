import { describe, expect, it } from "vitest";
import { installObsidianDom, uninstallObsidianDom } from "./install.js";

describe("installObsidianDom in the node environment", () => {
    it("fails loudly and says what to do", () => {
        let message = "";
        try {
            installObsidianDom();
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toContain("needs a DOM");
        // Written in two parts: Vitest scans test files for the docblock text and would run this file in jsdom.
        expect(message).toContain("@vitest-" + "environment jsdom");
        expect(message).toContain("`dom` option");
    });

    it("uninstall is harmless", () => {
        expect(() => {
            uninstallObsidianDom();
        }).not.toThrow();
    });
});
