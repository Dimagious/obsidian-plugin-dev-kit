import path from "node:path";
import { configDefaults } from "vitest/config";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";
import type { ResolvedUnitOptions } from "./options.js";

/**
 * The package `obsidian` has no JavaScript entry (`"main": ""`), so Vite cannot resolve `import "obsidian"` even
 * though the mocks' `vitest-setup` mocks it: the import is aliased to the mocks' own module as well.
 */
const MOCKS_ALIAS = { obsidian: "obsidian-test-mocks/obsidian" };

type Alias = Record<string, string>;

/** What `import "obsidian"` resolves to in the node project and in the DOM project (`undefined`: no alias). */
function obsidianAliases(options: ResolvedUnitOptions): { readonly node: Alias | undefined; readonly dom: Alias | undefined; readonly mocks: boolean } {
    const { obsidian, rootDir } = options;
    const stub = (file: string): Alias => ({ obsidian: path.resolve(rootDir, file) });
    switch (obsidian.kind) {
        case "none":
            return { node: undefined, dom: undefined, mocks: false };
        case "stub":
            return { node: stub(obsidian.path), dom: stub(obsidian.path), mocks: false };
        case "mocks":
            return { node: undefined, dom: MOCKS_ALIAS, mocks: true };
        case "split":
            return {
                node: stub(obsidian.node),
                dom: obsidian.dom.kind === "mocks" ? MOCKS_ALIAS : stub(obsidian.dom.path),
                mocks: obsidian.dom.kind === "mocks",
            };
    }
}

/** Test environments of the config: jsdom for the DOM files, node for the rest. */
const DOM_ENVIRONMENT = "jsdom";

function rootAlias(
    domKind: ResolvedUnitOptions["dom"]["kind"],
    aliases: ReturnType<typeof obsidianAliases>,
    sameAlias: boolean,
    alias: (value: Alias | undefined) => { resolve?: { alias: Alias } },
): { resolve?: { alias: Alias } } {
    if (domKind === "split") return sameAlias ? alias(aliases.node) : {};
    return alias(domKind === "all" ? aliases.dom : aliases.node);
}

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
    const { dom, coverage, include } = options;
    const aliases = obsidianAliases(options);
    const domSetup = aliases.mocks ? [setupFiles.mocks] : [setupFiles.dom];
    const alias = (value: Alias | undefined): { resolve?: { alias: Alias } } => (value === undefined ? {} : { resolve: { alias: value } });
    // One alias at the root when both sides agree; each project carries its own when they differ, so every
    // resolved project config shows exactly one `obsidian` entry. (A project alias would override a root one
    // anyway: Vite's mergeAlias puts the project entry first, see mergeConfigRecursively in vite/dist/node.)
    const sameAlias = aliases.node === aliases.dom || aliases.node?.obsidian === aliases.dom?.obsidian;
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
                      ...(sameAlias ? {} : alias(aliases.node)),
                  },
                  {
                      extends: true,
                      test: {
                          name: "dom",
                          environment: DOM_ENVIRONMENT,
                          include: [...dom.globs],
                          setupFiles: domSetup,
                      },
                      ...(sameAlias && aliases.node !== undefined ? {} : alias(aliases.dom)),
                  },
              ]
            : [];
    return {
        ...rootAlias(dom.kind, aliases, sameAlias, alias),
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
