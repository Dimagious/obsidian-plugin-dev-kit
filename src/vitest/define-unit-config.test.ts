import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineUnitConfig } from "./define-unit-config.js";
import * as vitestEntry from "./index.js";

describe("defineUnitConfig", () => {
    it("returns the config for valid options, resolving the stub against rootDir", () => {
        const config = defineUnitConfig({
            coverage: { include: ["src/**/*.ts"] },
            obsidian: "./stub.ts",
            rootDir: "/plugin",
        });
        expect(config.resolve?.alias).toEqual({ obsidian: path.resolve("/plugin", "stub.ts") });
        expect(config.test?.coverage?.provider).toBe("v8");
    });

    it("points the dom project at a setup file that exists next to this module", () => {
        const config = defineUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: "all" });
        const [setupFile] = config.test?.setupFiles ?? [];
        expect(typeof setupFile).toBe("string");
        expect(path.basename(String(setupFile))).toBe("setup.ts");
        expect(fs.existsSync(String(setupFile))).toBe(true);
    });

    it("uses obsidian-test-mocks' own setup file by package specifier", () => {
        const config = defineUnitConfig({ coverage: { include: ["src/**/*.ts"] }, obsidian: "obsidian-test-mocks", dom: "all" });
        expect(config.test?.setupFiles).toEqual(["obsidian-test-mocks/vitest-setup"]);
    });

    it("reports a missing coverage.include", () => {
        expect(() => defineUnitConfig({} as never)).toThrow('"coverage.include" is required');
    });

    it("the entry point exports the factory and the defaults, nothing else", () => {
        expect(Object.keys(vitestEntry).sort()).toEqual(["BASE_COVERAGE_EXCLUDE", "DEFAULT_THRESHOLDS", "defineUnitConfig"]);
    });
});
