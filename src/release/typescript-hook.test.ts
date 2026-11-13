import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `opdk scan` type-checks with its own TypeScript 6 and installs a resolve hook for it (src/scanner/typescript-six.ts).
// The release check lints with the plugin's own TypeScript and must never load that hook: a hook installed after the
// plugin's `typescript` is cached makes one lint use two compilers. The imports are checked statically because the
// hook is process-wide, so a run inside this process could not tell who installed it.

const SRC = path.resolve(import.meta.dirname, "..");
const HOOK_MODULES = new Set(["scanner/use-typescript-six.ts", "scanner/typescript-six.ts"]);
const STATIC_IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.[^"']*)["']|^\s*import\s*["'](\.[^"']*)["']/gm;

function importsOf(file: string): string[] {
    const found: string[] = [];
    for (const match of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
        const specifier = match[1] ?? match[2];
        if (specifier !== undefined) {
            found.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
        }
    }
    return found;
}

/** Every source file reachable from `entry` through static relative imports, entry included. */
function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (!seen.has(file)) {
            seen.add(file);
            queue.push(...importsOf(file));
        }
    }
    return seen;
}

describe("release check and the TypeScript 6 hook of opdk scan", () => {
    const releaseModules = readdirSync(path.join(SRC, "release"))
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => path.join(SRC, "release", name));

    it("finds the release modules and follows their imports (the walk is not empty)", () => {
        expect(releaseModules.length).toBeGreaterThan(5);
        const apiCheck = reachable(path.join(SRC, "release", "api-check.ts"));
        expect(apiCheck.has(path.join(SRC, "scanner", "outside-project.ts"))).toBe(true);
    });

    it("sees an import of the hook module when there is one (the walk would catch a regression)", () => {
        expect([...reachable(path.join(SRC, "scanner", "lint.ts"))].some((file) => HOOK_MODULES.has(path.relative(SRC, file)))).toBe(true);
    });

    it.each(releaseModules.map((file) => [path.basename(file), file] as const))("%s does not import the hook, directly or through another module", (_name, file) => {
        const hooked = [...reachable(file)].map((module) => path.relative(SRC, module)).filter((module) => HOOK_MODULES.has(module));
        expect(hooked).toEqual([]);
    });
});
