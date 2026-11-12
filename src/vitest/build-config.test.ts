import path from "node:path";
import { configDefaults, mergeConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";
import { describe, expect, it } from "vitest";
import { buildUnitConfig } from "./build-config.js";
import { resolveUnitOptions } from "./options.js";
import type { UnitConfigOptions } from "./options.js";

const setup = { dom: "/kit/dom/setup.js", mocks: "obsidian-test-mocks/vitest-setup" };
const WORKSPACE_ROOT = "/workspace";

function build(options: Partial<UnitConfigOptions> = {}): ReturnType<typeof buildUnitConfig> {
    return buildUnitConfig(resolveUnitOptions({ coverage: { include: ["src/**/*.ts"] }, ...options }, "/plugin"), setup, WORKSPACE_ROOT);
}

describe("buildUnitConfig defaults", () => {
    it("is one node project with the v8 gate and no alias", () => {
        const config = build();
        expect(config.resolve).toBeUndefined();
        expect(config.test).toEqual({
            include: ["src/**/*.test.ts"],
            environment: "node",
            coverage: {
                enabled: true,
                provider: "v8",
                reporter: ["text", "json-summary"],
                reportsDirectory: "coverage",
                include: ["src/**/*.ts"],
                exclude: ["**/*.test.ts", "src/test/**", "**/*.d.ts"],
                thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
            },
        });
    });

    it("dom: [] gives the same node-only config", () => {
        expect(build({ dom: [] })).toEqual(build());
    });

    it("does not share its arrays with the resolved options, so a plugin can edit the result", () => {
        const first = build();
        first.test?.include?.push("x");
        expect(build().test?.include).toEqual(["src/**/*.test.ts"]);
    });
});

describe("buildUnitConfig obsidian", () => {
    it("aliases a stub path resolved from rootDir", () => {
        const config = build({ obsidian: "./src/test/stubs/obsidian.ts", rootDir: "/plugin" });
        expect(config.resolve?.alias).toEqual({ obsidian: path.resolve("/plugin", "./src/test/stubs/obsidian.ts") });
    });

    it("keeps an absolute stub path as it is", () => {
        expect(build({ obsidian: "/abs/stub.ts" }).resolve?.alias).toEqual({ obsidian: "/abs/stub.ts" });
    });
});

describe("buildUnitConfig obsidian { node, dom }", () => {
    const globs = ["src/ui/**/*.test.ts"];

    it("gives the node project the stub and the dom project the mocks, with no alias at the root", () => {
        const config = build({ obsidian: { node: "./stubs/node.ts", dom: "obsidian-test-mocks" }, dom: globs, rootDir: "/plugin" });
        expect(config.resolve).toBeUndefined();
        expect(config.test?.projects?.[0]).toMatchObject({
            test: { name: "unit" },
            resolve: { alias: { obsidian: path.resolve("/plugin", "./stubs/node.ts") } },
        });
        expect(config.test?.projects?.[1]).toMatchObject({
            test: { name: "dom", setupFiles: [setup.mocks] },
            resolve: { alias: { obsidian: "obsidian-test-mocks/obsidian" } },
        });
    });

    it("two stubs: each project gets its own alias and the dom project keeps the kit polyfill", () => {
        const config = build({ obsidian: { node: "./a.ts", dom: "./b.ts" }, dom: globs, rootDir: "/plugin" });
        expect(config.test?.projects?.[0]).toMatchObject({ resolve: { alias: { obsidian: path.resolve("/plugin", "a.ts") } } });
        expect(config.test?.projects?.[1]).toMatchObject({
            test: { setupFiles: [setup.dom] },
            resolve: { alias: { obsidian: path.resolve("/plugin", "b.ts") } },
        });
    });

    it("the same stub on both sides is one root alias, as the string form", () => {
        const config = build({ obsidian: { node: "./a.ts", dom: "./a.ts" }, dom: globs, rootDir: "/plugin" });
        expect(config).toEqual(build({ obsidian: "./a.ts", dom: globs, rootDir: "/plugin" }));
    });

    it("dom: 'all' uses the dom side at the root, no dom globs uses the node side", () => {
        expect(build({ obsidian: { node: "./a.ts", dom: "obsidian-test-mocks" }, dom: "all" }).resolve?.alias).toEqual({
            obsidian: "obsidian-test-mocks/obsidian",
        });
        expect(build({ obsidian: { node: "./a.ts", dom: "./b.ts" }, rootDir: "/plugin" }).resolve?.alias).toEqual({
            obsidian: path.resolve("/plugin", "a.ts"),
        });
    });
});

describe("buildUnitConfig dom", () => {
    it("'all' runs everything in jsdom with the kit setup file and no projects", () => {
        const { test } = build({ dom: "all" });
        expect(test?.environment).toBe("jsdom");
        expect(test?.setupFiles).toEqual([setup.dom]);
        expect(test?.projects).toBeUndefined();
    });

    it("globs make a node 'unit' project that excludes them and a jsdom 'dom' project that includes them", () => {
        const { test } = build({ dom: ["src/ui/**/*.test.ts", "src/blocks/**/*.test.ts"] });
        expect(test?.environment).toBe("node");
        expect(test?.setupFiles).toBeUndefined();
        // Vitest 5 appends a project's include to the root one, so the root has none (the dom project would run everything).
        expect(test?.include).toBeUndefined();
        expect(test?.projects).toHaveLength(2);
        const projects: unknown[] = test?.projects ?? [];
        const [unit, dom] = projects;
        expect(unit).toMatchObject({
            extends: true,
            test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] },
        });
        expect(unit).toMatchObject({ test: { exclude: [...configDefaults.exclude, "src/ui/**/*.test.ts", "src/blocks/**/*.test.ts"] } });
        expect(dom).toEqual({
            extends: true,
            test: {
                name: "dom",
                environment: "jsdom",
                include: ["src/ui/**/*.test.ts", "src/blocks/**/*.test.ts"],
                setupFiles: [setup.dom],
            },
        });
    });

    it("the coverage gate stays at the root, so it covers both projects", () => {
        const { test } = build({ dom: ["src/ui/**/*.test.ts"] });
        expect(test?.coverage?.thresholds).toEqual({ lines: 90, functions: 90, statements: 90, branches: 80 });
        expect(test?.coverage?.include).toEqual(["src/**/*.ts"]);
    });

    it("obsidian-test-mocks replaces the kit polyfill with its own setup file, in the dom project only", () => {
        const split = build({ obsidian: "obsidian-test-mocks", dom: ["src/ui/**/*.test.ts"] });
        expect(split.resolve).toBeUndefined();
        expect(split.test?.setupFiles).toBeUndefined();
        // The `obsidian` package has no JS entry, so the import is also aliased to the mocks, in the dom project only.
        expect(split.test?.projects?.[1]).toMatchObject({
            test: { name: "dom", setupFiles: [setup.mocks] },
            resolve: { alias: { obsidian: "obsidian-test-mocks/obsidian" } },
        });
        expect(split.test?.projects?.[0]).not.toHaveProperty("resolve");
        const all = build({ obsidian: "obsidian-test-mocks", dom: "all" });
        expect(all.test?.setupFiles).toEqual([setup.mocks]);
        expect(all.resolve?.alias).toEqual({ obsidian: "obsidian-test-mocks/obsidian" });
    });
});

describe("buildUnitConfig as an escape hatch", () => {
    it("is plain data that mergeConfig accepts", () => {
        const merged: ViteUserConfig = mergeConfig(build(), { test: { testTimeout: 1234, coverage: { thresholds: { branches: 95 } } } });
        expect(merged).toMatchObject({ test: { testTimeout: 1234, coverage: { thresholds: { lines: 90, branches: 95 }, provider: "v8" } } });
    });
});

describe("buildUnitConfig server.fs.allow", () => {
    const globs = ["src/ui/**/*.test.ts"];

    it("allows the kit's folder and the workspace root when the kit sits outside the plugin (npm link, file:)", () => {
        expect(build({ dom: globs, rootDir: "/plugin" }).server).toEqual({ fs: { allow: [WORKSPACE_ROOT, "/kit/dom"] } });
        expect(build({ dom: "all", rootDir: "/plugin" }).server).toEqual({ fs: { allow: [WORKSPACE_ROOT, "/kit/dom"] } });
    });

    it("adds nothing when the kit is a copy inside the plugin, and does not turn off fs.strict", () => {
        const config = buildUnitConfig(
            resolveUnitOptions({ coverage: { include: ["src/**/*.ts"] }, dom: globs }, "/plugin"),
            { dom: "/plugin/node_modules/obsidian-plugin-dev-kit/dist/vitest/dom/setup.js", mocks: setup.mocks },
            WORKSPACE_ROOT,
        );
        expect(config.server).toBeUndefined();
    });

    it("treats a folder that only shares a name prefix with the plugin as outside it", () => {
        const config = buildUnitConfig(
            resolveUnitOptions({ coverage: { include: ["src/**/*.ts"] }, dom: globs }, "/plugin"),
            { dom: "/plugin-kit/dom/setup.js", mocks: setup.mocks },
            WORKSPACE_ROOT,
        );
        expect(config.server).toEqual({ fs: { allow: [WORKSPACE_ROOT, "/plugin-kit/dom"] } });
    });

    it("adds nothing when no test uses the kit's setup file: no dom, or the mocks' own setup file", () => {
        expect(build({ rootDir: "/plugin" }).server).toBeUndefined();
        expect(build({ obsidian: "obsidian-test-mocks", dom: globs, rootDir: "/plugin" }).server).toBeUndefined();
    });

    it("mergeConfig appends a plugin's own allow entries to the kit's", () => {
        const merged: ViteUserConfig = mergeConfig(build({ dom: globs, rootDir: "/plugin" }), { server: { fs: { allow: ["/shared"] } } });
        expect(merged.server?.fs?.allow).toEqual([WORKSPACE_ROOT, "/kit/dom", "/shared"]);
    });
});
