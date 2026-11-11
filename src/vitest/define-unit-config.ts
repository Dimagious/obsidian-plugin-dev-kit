import { fileURLToPath } from "node:url";
import type { ViteUserConfig } from "vitest/config";
import { buildUnitConfig } from "./build-config.js";
import { resolveUnitOptions } from "./options.js";
import type { UnitConfigOptions } from "./options.js";

/** The setup file of the kit's DOM polyfill, next to this module (`.js` in `dist/`, `.ts` when run from `src/`). */
function sibling(relative: string): string {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    return fileURLToPath(new URL(`${relative}${extension}`, import.meta.url));
}

/**
 * The unit-test setup Snipsy, Dashy and Garmy share, as a Vitest config to export from the plugin's own
 * `vitest.config.ts`:
 *
 * ```ts
 * import { defineUnitConfig } from "obsidian-plugin-dev-kit/vitest";
 * export default defineUnitConfig({
 *     coverage: { include: ["src/**\/*.ts"], exclude: ["src/main.ts"] },
 *     obsidian: "./src/test/stubs/obsidian.ts",
 *     dom: ["src/ui/**\/*.test.ts"],
 * });
 * ```
 *
 * Defaults: tests in `src/**\/*.test.ts` run in node with the v8 coverage provider, reporters `text` and
 * `json-summary` (`coverage/`), and the thresholds 90 lines, functions and statements, 80 branches. Files listed in
 * `dom` run in jsdom with Obsidian's DOM helpers installed. The result is a plain config: spread it or `mergeConfig` it.
 *
 * Needs `vitest` and `@vitest/coverage-v8` (the same version) in the plugin, and `jsdom` when `dom` is used.
 */
export function defineUnitConfig(options: UnitConfigOptions): ViteUserConfig {
    const resolved = resolveUnitOptions(options, process.cwd());
    return buildUnitConfig(resolved, { dom: sibling("./dom/setup"), mocks: "obsidian-test-mocks/vitest-setup" });
}
