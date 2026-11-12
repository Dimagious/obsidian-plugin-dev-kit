import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVersionReader } from "../peers/resolve.js";
import type { VersionReader } from "../peers/versions.js";
import { createUnitConfig, defineUnitConfig } from "./define-unit-config.js";
import * as vitestEntry from "./index.js";

function installed(versions: Record<string, string>): () => VersionReader {
    return () => (name) => versions[name];
}
const GOOD = installed({ vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0", jsdom: "30.1.1" });

describe("defineUnitConfig", () => {
    it("returns the config for valid options, resolving the stub against rootDir", () => {
        const config = createUnitConfig(
            {
                coverage: { include: ["src/**/*.ts"] },
                obsidian: "./stub.ts",
                rootDir: "/plugin",
            },
            GOOD,
        );
        expect(config.resolve?.alias).toEqual({ obsidian: path.resolve("/plugin", "stub.ts") });
        expect(config.test?.coverage?.provider).toBe("v8");
    });

    it("accepts a relative rootDir with the real reader", () => {
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: "all", rootDir: "." }, (rootDir) => createVersionReader(rootDir))).not.toThrow();
    });

    it("points the dom project at a setup file that exists next to this module", () => {
        const config = createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: "all" }, GOOD);
        const [setupFile] = config.test?.setupFiles ?? [];
        expect(typeof setupFile).toBe("string");
        expect(path.basename(String(setupFile))).toBe("setup.ts");
        expect(fs.existsSync(String(setupFile))).toBe(true);
    });

    it("uses obsidian-test-mocks' own setup file by package specifier", () => {
        const config = createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, obsidian: "obsidian-test-mocks", dom: "all" }, GOOD);
        expect(config.test?.setupFiles).toEqual(["obsidian-test-mocks/vitest-setup"]);
    });

    it("reports a missing coverage.include", () => {
        expect(() => defineUnitConfig({} as never)).toThrow('"coverage.include" is required');
    });

    it("reads the versions from the folder given as rootDir", () => {
        const folders: string[] = [];
        createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, rootDir: "/plugin" }, (rootDir) => {
            folders.push(rootDir);
            return GOOD();
        });
        expect(folders).toEqual(["/plugin"]);
    });

    it("refuses an old Vitest before building anything", () => {
        const old = installed({ vitest: "3.2.4", "@vitest/coverage-v8": "3.2.4" });
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] } }, old)).toThrow(
            '"vitest" 3.2.4 is installed; the kit needs ^5.0.0.',
        );
    });

    it("checks jsdom only when a test project uses the DOM", () => {
        const noJsdom = installed({ vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0" });
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] } }, noJsdom)).not.toThrow();
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: ["src/ui/**/*.test.ts"] }, noJsdom)).toThrow(
            '"jsdom" is not installed',
        );
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: "all" }, noJsdom)).toThrow('"jsdom" is not installed');
        expect(() => createUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: [] }, noJsdom)).not.toThrow();
    });

    it("accepts the packages the kit itself runs on when resolved from its own folder", () => {
        expect(() => defineUnitConfig({ coverage: { include: ["src/**/*.ts"] }, dom: "all", rootDir: process.cwd() })).not.toThrow();
    });

    it("the entry point exports the factory and the defaults, nothing else", () => {
        expect(Object.keys(vitestEntry).sort()).toEqual(["BASE_COVERAGE_EXCLUDE", "DEFAULT_THRESHOLDS", "defineUnitConfig"]);
    });
});
