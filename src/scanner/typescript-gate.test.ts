import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { describeTypescriptGap, missingTypescriptPreflight, readPluginTypescriptVersion } from "./typescript-gate.js";

describe("describeTypescriptGap", () => {
    it.each(["6.0.3", "6.0.0", "7.0.0", "6.1.0-beta"])("lets TypeScript %s through", (version) => {
        expect(describeTypescriptGap(version)).toBeUndefined();
    });

    it.each(["5.9.3", "5.0.0", "4.9.5"])("fails TypeScript %s and says what to install", (version) => {
        const gap = describeTypescriptGap(version);
        expect(gap?.message).toContain(`TypeScript ${version}`);
        expect(gap?.message).toContain("no-unsafe-call");
        expect(gap?.message).toContain("moment(...)");
        expect(gap?.hint).toContain("npm install -D typescript@6");
        expect(gap?.hint).toContain("TS2349");
    });

    it("fails when no TypeScript is installed and names the install command", () => {
        const gap = describeTypescriptGap(undefined);
        expect(gap?.message).toContain("no TypeScript installed");
        expect(gap?.hint).toContain("npm install -D typescript@6");
    });

    it("does not fail on a version it cannot read", () => {
        expect(describeTypescriptGap("next")).toBeUndefined();
    });
});

describe("readPluginTypescriptVersion", () => {
    it("reads the TypeScript the install resolves from typescript-eslint", () => {
        const manifest = createRequire(import.meta.url)("typescript/package.json") as { version: string };
        expect(readPluginTypescriptVersion()).toBe(manifest.version);
    });

    it("returns undefined when the package cannot be found", () => {
        const missing = Object.assign(new Error("Cannot find module 'typescript/package.json'"), { code: "MODULE_NOT_FOUND" });
        expect(readPluginTypescriptVersion(() => { throw missing; })).toBeUndefined();
    });

    it("rethrows any other failure", () => {
        expect(() => readPluginTypescriptVersion(() => { throw new Error("EACCES"); })).toThrow("EACCES");
    });

    it("fails with the reinstall command when the manifest has no version", () => {
        expect(() => readPluginTypescriptVersion(() => ({ name: "typescript" }))).toThrow("npm install -D typescript@6");
    });
});

describe("missingTypescriptPreflight", () => {
    it("fails with the install command when no TypeScript is installed, before anything loads it", () => {
        const ctx = createContext("/plugin");
        expect(missingTypescriptPreflight("my-plugin", ctx.reporter, () => undefined)).toBe(1);
        const text = ctx.err.join("");
        expect(text).toContain("my-plugin: the plugin has no TypeScript installed");
        expect(text).toContain("npm install -D typescript@6");
    });

    it("leaves any installed TypeScript to runScan, older ones included", () => {
        for (const version of ["6.0.3", "5.9.3"]) {
            const ctx = createContext("/plugin");
            expect(missingTypescriptPreflight("my-plugin", ctx.reporter, () => version)).toBeUndefined();
            expect([...ctx.out, ...ctx.err].join("")).toBe("");
        }
    });
});
