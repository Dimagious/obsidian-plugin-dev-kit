import { describe, expect, it } from "vitest";
import { defineConfig } from "./define-config.js";

describe("defineConfig", () => {
    it("returns the very object it was given", () => {
        const config = {};
        expect(defineConfig(config)).toBe(config);
    });
});
