import path from "node:path";
import { configDefaults } from "vitest/config";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";
import type { ResolvedUnitOptions } from "./options.js";

/**
 * The package `obsidian` has no JavaScript entry (`"main": ""`), so Vite cannot resolve `import "obsidian"` even
 * though the mocks' `vitest-setup` mocks it: the import is aliased to the mocks' own module as well.
 */
const MOCKS_ALIAS = { obsidian: "obsidian-test-mocks/obsidian" };

/** Test environments of the config: jsdom for the DOM files, node for the rest. */
const DOM_ENVIRONMENT = "jsdom";

/**
 * The Vitest config for resolved options. Pure: the paths of the two setup files are passed in, so no test needs
 * the built package on disk.
 *
 * The config is plain data. A plugin that needs more spreads or `mergeConfig`s it.
 */
export function buildUnitConfig(
    options: ResolvedUnitOptions,
    setupFiles: { readonly dom: string; readonly mocks: string },
): ViteUserConfig {
    const { dom, obsidian, coverage, include, rootDir } = options;
    const domSetup = obsidian.kind === "mocks" ? [setupFiles.mocks] : [setupFiles.dom];
    // Both modes need the DOM first; the mocks package patches it, the kit polyfill fills it.
    const projects: TestProjectInlineConfiguration[] =
        dom.kind === "split"
            ? [
                  {
                      extends: true,
                      test: {
                          name: "unit",
                          environment: "node",
                          include: [...include],
                          exclude: [...configDefaults.exclude, ...dom.globs],
                      },
                  },
                  {
                      extends: true,
                      test: {
                          name: "dom",
                          environment: DOM_ENVIRONMENT,
                          include: [...dom.globs],
                          setupFiles: domSetup,
                      },
                      ...(obsidian.kind === "mocks" ? { resolve: { alias: MOCKS_ALIAS } } : {}),
                  },
              ]
            : [];
    return {
        ...(obsidian.kind === "stub" ? { resolve: { alias: { obsidian: path.resolve(rootDir, obsidian.path) } } } : {}),
        ...(obsidian.kind === "mocks" && dom.kind === "all" ? { resolve: { alias: MOCKS_ALIAS } } : {}),
        test: {
            // Projects append their own include to the root one (Vitest 5), so with projects the root must have none.
            ...(projects.length > 0 ? {} : { include: [...include] }),
            environment: dom.kind === "all" ? DOM_ENVIRONMENT : "node",
            ...(dom.kind === "all" ? { setupFiles: domSetup } : {}),
            ...(projects.length > 0 ? { projects } : {}),
            coverage: {
                enabled: true,
                provider: "v8",
                reporter: [...coverage.reporters],
                reportsDirectory: "coverage",
                include: [...coverage.include],
                exclude: [...coverage.exclude],
                thresholds: { ...coverage.thresholds },
            },
        },
    };
}
