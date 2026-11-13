import { mkdirSync, symlinkSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createPluginFixture } from "../test-support/plugin-fixture.js";
import { redirectTypescript } from "./typescript-six.js";

// Real ESLint with type information over a real `obsidian` typing.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// A plugin that installed TypeScript 5.9: every bare `typescript` request resolves to the kit's `plugin-typescript-5`
// devDependency, as it would to the plugin's own copy. This hook is registered before the kit's (Node runs the
// last-registered hook first), so the scan's hook has to win for the scan to type-check with 6. The kit's own
// `typescript` devDependency is 6.0.3, so without this the test would pass with no hook at all.
// `plugin-typescript-5` is an npm alias of typescript@5.9.3. It ships a `tsc` bin that npm may link over the real one, so
// package.json runs `node node_modules/typescript/bin/tsc` for `typecheck` and `build` instead of the `tsc` bin.
const requireFromKit = nodeModule.createRequire(import.meta.url);
const pluginTypescriptDir = path.dirname(requireFromKit.resolve("plugin-typescript-5/package.json"));
nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
        const target = redirectTypescript(specifier, pluginTypescriptDir);
        if (target === undefined) {
            return nextResolve(specifier, context);
        }
        return nextResolve(context.conditions.includes("require") ? target : pathToFileURL(target).href, context);
    },
});

const versionOf = (name: string): string => {
    const manifest: unknown = requireFromKit(`${name}/package.json`);
    return typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string" ? manifest.version : "";
};

describe("a plugin on TypeScript 5", () => {
    it("is scanned with TypeScript 6: moment(...) imported from obsidian gets the three warnings the scorecard lists", async () => {
        // Before the scan's modules load, as in a plugin's own process: the plugin's TypeScript is the one in the cache.
        expect(requireFromKit("typescript")).toMatchObject({ version: "5.9.3" });
        const { runScannerLint } = await import("./lint.js");
        const { scanTypescript } = await import("./use-typescript-six.js");

        const plugin = createPluginFixture();
        try {
            mkdirSync(path.join(plugin.dir, "node_modules"));
            for (const name of ["obsidian", "moment"]) {
                symlinkSync(path.dirname(requireFromKit.resolve(`${name}/package.json`)), path.join(plugin.dir, "node_modules", name), "dir");
            }
            plugin.write(
                "tsconfig.json",
                JSON.stringify({
                    compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] },
                    include: ["src/**/*.ts"],
                }),
            );
            plugin.write("src/main.ts", ['import { moment } from "obsidian";', 'export const stamp = (): string => moment(new Date()).format("x");', ""].join("\n"));

            const { findings } = await runScannerLint(plugin.dir, ["src/main.ts"]);

            expect(scanTypescript).toMatchObject({ forced: true, version: versionOf("typescript-6") });
            // The `typescript` that typescript-eslint loads (not this file's `require`, which cached its answer before the hook).
            const fromEstree = nodeModule.createRequire(nodeModule.createRequire(requireFromKit.resolve("typescript-eslint")).resolve("@typescript-eslint/typescript-estree"));
            expect(fromEstree("typescript")).toMatchObject({ version: versionOf("typescript-6") });
            expect(findings.map((finding) => finding.rule).sort(), JSON.stringify(findings)).toEqual([
                "@typescript-eslint/no-unsafe-call",
                "@typescript-eslint/no-unsafe-member-access",
                "@typescript-eslint/no-unsafe-return",
            ]);
            expect(findings.every((finding) => finding.file === "src/main.ts" && finding.line === 2)).toBe(true);
        } finally {
            plugin.cleanup();
        }
    });
});
