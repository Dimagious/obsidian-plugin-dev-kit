import { describe, expect, it } from "vitest";
import { BASE_COVERAGE_EXCLUDE, DEFAULT_THRESHOLDS, resolveUnitOptions } from "./options.js";
import type { UnitConfigOptions } from "./options.js";

const minimal: UnitConfigOptions = { coverage: { include: ["src/**/*.ts"] } };

function fails(options: unknown): string {
    try {
        resolveUnitOptions(options as UnitConfigOptions, "/plugin");
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error("resolveUnitOptions did not throw");
}

describe("resolveUnitOptions defaults", () => {
    it("fills in what the three plugins use today", () => {
        const resolved = resolveUnitOptions(minimal, "/plugin");
        expect(resolved.rootDir).toBe("/plugin");
        expect(resolved.include).toEqual(["src/**/*.test.ts"]);
        expect(resolved.obsidian).toEqual({ kind: "none" });
        expect(resolved.dom).toEqual({ kind: "none" });
        expect(resolved.coverage.thresholds).toEqual({ lines: 90, functions: 90, statements: 90, branches: 80 });
        expect(resolved.coverage.reporters).toEqual(["text", "json-summary"]);
        expect(resolved.coverage.exclude).toEqual(["**/*.test.ts", "src/test/**", "**/*.d.ts"]);
        expect(resolved.coverage.include).toEqual(["src/**/*.ts"]);
    });

    it("keeps the exported defaults in step with the resolved ones", () => {
        expect(DEFAULT_THRESHOLDS).toEqual(resolveUnitOptions(minimal, "/").coverage.thresholds);
        expect(BASE_COVERAGE_EXCLUDE).toEqual(resolveUnitOptions(minimal, "/").coverage.exclude);
    });
});

describe("resolveUnitOptions values", () => {
    it("takes rootDir, include, extra excludes and extra reporters", () => {
        const resolved = resolveUnitOptions(
            {
                rootDir: "/other",
                include: ["tests/**/*.test.ts"],
                coverage: { include: ["src/**"], exclude: ["src/main.ts"], extraReporters: ["lcov", "html"] },
            },
            "/plugin",
        );
        expect(resolved.rootDir).toBe("/other");
        expect(resolved.include).toEqual(["tests/**/*.test.ts"]);
        expect(resolved.coverage.exclude).toEqual([...BASE_COVERAGE_EXCLUDE, "src/main.ts"]);
        expect(resolved.coverage.reporters).toEqual(["text", "json-summary", "lcov", "html"]);
    });

    it("distinguishes a stub path, obsidian-test-mocks and no alias", () => {
        expect(resolveUnitOptions({ ...minimal, obsidian: "./src/test/stub.ts" }, "/p").obsidian).toEqual({
            kind: "stub",
            path: "./src/test/stub.ts",
        });
        expect(resolveUnitOptions({ ...minimal, obsidian: "obsidian-test-mocks", dom: "all" }, "/p").obsidian).toEqual({ kind: "mocks" });
    });

    it("the { node, dom } form picks a stub for node and mocks or another stub for the DOM tests", () => {
        expect(
            resolveUnitOptions({ ...minimal, obsidian: { node: "./stubs/node.ts", dom: "obsidian-test-mocks" }, dom: ["src/ui/**/*.test.ts"] }, "/p").obsidian,
        ).toEqual({ kind: "split", node: "./stubs/node.ts", dom: { kind: "mocks" } });
        expect(resolveUnitOptions({ ...minimal, obsidian: { node: "./stubs/node.ts", dom: "./stubs/dom.ts" } }, "/p").obsidian).toEqual({
            kind: "split",
            node: "./stubs/node.ts",
            dom: { kind: "stub", path: "./stubs/dom.ts" },
        });
    });

    it("dom: globs split, [] means none, 'all' means all", () => {
        expect(resolveUnitOptions({ ...minimal, dom: ["src/ui/**/*.test.ts"] }, "/p").dom).toEqual({
            kind: "split",
            globs: ["src/ui/**/*.test.ts"],
        });
        expect(resolveUnitOptions({ ...minimal, dom: [] }, "/p").dom).toEqual({ kind: "none" });
        expect(resolveUnitOptions({ ...minimal, dom: "all" }, "/p").dom).toEqual({ kind: "all" });
    });

    it("raising a threshold keeps the others at the default", () => {
        const { thresholds } = resolveUnitOptions({ coverage: { include: ["src/**"], thresholds: { branches: 85, lines: 95 } } }, "/p").coverage;
        expect(thresholds).toEqual({ lines: 95, functions: 90, statements: 90, branches: 85 });
    });

    it("lowering a threshold works only with allowLowerThresholds", () => {
        const { thresholds } = resolveUnitOptions(
            { coverage: { include: ["src/**"], thresholds: { branches: 70 }, allowLowerThresholds: true } },
            "/p",
        ).coverage;
        expect(thresholds.branches).toBe(70);
        expect(thresholds.lines).toBe(90);
    });
});

describe("resolveUnitOptions errors", () => {
    it("requires coverage.include and shows an example", () => {
        for (const bad of [{}, { coverage: {} }, { coverage: { include: [] } }, { coverage: { include: "src/**" } }, { coverage: { include: [""] } }]) {
            const message = fails(bad);
            expect(message).toContain('"coverage.include" is required');
            expect(message).toContain('defineUnitConfig({ coverage: { include: ["src/**/*.ts"]');
        }
    });

    it("rejects missing options, unknown keys (naming them) and unknown coverage keys", () => {
        expect(fails(undefined)).toContain("options are required");
        expect(fails({ ...minimal, domm: [] })).toContain("unknown option(s): domm");
        expect(fails({ coverage: { include: ["a"], treshold: {} } })).toContain("unknown coverage option(s): treshold");
    });

    it("rejects values of the wrong type, naming the option", () => {
        expect(fails({ ...minimal, rootDir: "" })).toContain('"rootDir"');
        expect(fails({ ...minimal, include: [] })).toContain('"include"');
        expect(fails({ ...minimal, include: "src" })).toContain('"include"');
        expect(fails({ ...minimal, obsidian: 3 })).toContain('"obsidian"');
        expect(fails({ ...minimal, obsidian: "" })).toContain('"obsidian"');
        expect(fails({ ...minimal, dom: "some" })).toContain('"dom"');
        expect(fails({ ...minimal, dom: [1] })).toContain('"dom"');
        expect(fails({ coverage: { include: ["a"], exclude: "x" } })).toContain('"coverage.exclude"');
        expect(fails({ coverage: { include: ["a"], extraReporters: ["text"] } })).toContain('"coverage.extraReporters"');
        expect(fails({ coverage: { include: ["a"], thresholds: 90 } })).toContain('"coverage.thresholds"');
    });

    it("rejects a wrong { node, dom } object, naming the key", () => {
        const dom = ["src/ui/**/*.test.ts"];
        expect(fails({ ...minimal, dom, obsidian: { dom: "obsidian-test-mocks" } })).toContain('"obsidian.node"');
        expect(fails({ ...minimal, dom, obsidian: { node: "", dom: "obsidian-test-mocks" } })).toContain('"obsidian.node"');
        expect(fails({ ...minimal, dom, obsidian: { node: "./stub.ts" } })).toContain('"obsidian.dom"');
        expect(fails({ ...minimal, dom, obsidian: { node: "./stub.ts", dom: 1 } })).toContain('"obsidian.dom"');
        expect(fails({ ...minimal, dom, obsidian: { node: "./stub.ts", dom: "x", mocks: true } })).toContain("unknown \"obsidian\" key(s): mocks");
        expect(fails({ ...minimal, dom, obsidian: ["./stub.ts"] })).toContain('"obsidian"');
        const mocksInNode = fails({ ...minimal, dom, obsidian: { node: "obsidian-test-mocks", dom: "obsidian-test-mocks" } });
        expect(mocksInNode).toContain('"obsidian.node" cannot be "obsidian-test-mocks"');
    });

    it("{ node, dom: 'obsidian-test-mocks' } needs dom globs like the string form, a stub for dom does not", () => {
        for (const dom of [undefined, []]) {
            expect(fails({ ...minimal, dom, obsidian: { node: "./stub.ts", dom: "obsidian-test-mocks" } })).toContain("needs a DOM environment");
        }
        expect(resolveUnitOptions({ ...minimal, obsidian: { node: "./a.ts", dom: "./b.ts" } }, "/p").obsidian.kind).toBe("split");
    });

    it("coverage.allowLowerThresholds must be a boolean", () => {
        for (const bad of ["true", 1, null, {}]) {
            expect(fails({ coverage: { include: ["a"], allowLowerThresholds: bad } })).toContain('"coverage.allowLowerThresholds" must be true or false');
        }
        expect(resolveUnitOptions({ coverage: { include: ["a"], allowLowerThresholds: false } }, "/p").coverage.thresholds).toEqual(DEFAULT_THRESHOLDS);
    });

    it("rejects an unknown or out-of-range threshold", () => {
        expect(fails({ coverage: { include: ["a"], thresholds: { line: 95 } } })).toContain('unknown threshold "line"');
        expect(fails({ coverage: { include: ["a"], thresholds: { lines: 101 } } })).toContain('"lines" must be a number from 0 to 100');
        expect(fails({ coverage: { include: ["a"], thresholds: { lines: "95" } } })).toContain('"lines" must be a number');
        expect(fails({ coverage: { include: ["a"], thresholds: { lines: Number.NaN } } })).toContain('"lines" must be a number');
    });

    it("never lowers a threshold silently, and says how to do it on purpose", () => {
        const message = fails({ coverage: { include: ["a"], thresholds: { statements: 80 } } });
        expect(message).toContain("below the default 90");
        expect(message).toContain("allowLowerThresholds: true");
        expect(fails({ coverage: { include: ["a"], thresholds: { branches: 79 } } })).toContain("below the default 80");
    });

    it("obsidian-test-mocks without a DOM is an error that says what to add", () => {
        for (const dom of [undefined, []]) {
            const message = fails({ ...minimal, obsidian: "obsidian-test-mocks", dom });
            expect(message).toContain("needs a DOM environment");
            expect(message).toContain('dom: "all"');
        }
    });
});
