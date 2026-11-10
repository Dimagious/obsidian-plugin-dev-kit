import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { runCssStep } from "./css-step.js";

describe("runCssStep", () => {
    let plugin: PluginFixture;
    beforeEach(() => {
        plugin = createPluginFixture();
    });
    afterEach(() => {
        plugin.cleanup();
    });
    const css = { entry: "src/styles/main.css", outfile: "styles.css" };

    it("prints the built line when the entry exists", () => {
        plugin.write("src/styles/main.css", ".a{}");
        const ctx = createContext(plugin.dir);
        expect(runCssStep(plugin.dir, css, ctx).status).toBe("built");
        expect(ctx.out.join("")).toContain("✓ css     src/styles/main.css -> styles.css (1 file, 1 line)");
    });

    it("prints a `·` line when the entry is missing and a styles.css exists", () => {
        plugin.write("styles.css", ".hand{}");
        const ctx = createContext(plugin.dir);
        expect(runCssStep(plugin.dir, css, ctx).status).toBe("no-entry");
        expect(ctx.out.join("")).toBe("· css     no src/styles/main.css, keeping styles.css as is\n");
        expect(ctx.err).toEqual([]);
    });

    it("prints a `!` line when the entry and styles.css are both missing", () => {
        const ctx = createContext(plugin.dir);
        expect(runCssStep(plugin.dir, css, ctx).status).toBe("no-entry");
        expect(ctx.out.join("")).toBe("! css     no src/styles/main.css and no styles.css, the plugin ships no stylesheet\n");
    });

    it("prints nothing for a missing entry when told not to announce it", () => {
        const withFile = createContext(plugin.dir);
        expect(runCssStep(plugin.dir, css, withFile, false).status).toBe("no-entry");
        plugin.write("styles.css", ".hand{}");
        const withoutFile = createContext(plugin.dir);
        expect(runCssStep(plugin.dir, css, withoutFile, false).status).toBe("no-entry");
        expect([withFile.out, withFile.err, withoutFile.out, withoutFile.err]).toEqual([[], [], [], []]);
    });
});
