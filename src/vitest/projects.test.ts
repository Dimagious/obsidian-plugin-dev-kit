import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UnitConfigOptions } from "./options.js";

let root: string;

beforeEach(() => {
    // realpath: Vitest reports files by their real path, and the temp folder is a symlink on macOS.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opdk-vitest-projects-")));
    for (const file of ["src/core/a.test.ts", "src/core/b.test.ts", "src/ui/c.test.ts", "src/ui/d.test.ts", "scripts/e.test.ts"]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "");
    }
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/** Which project (and test environment) Vitest itself assigns each test file to, for options given to defineUnitConfig(). */
async function assignment(options: Pick<UnitConfigOptions, "dom" | "include">): Promise<string[]> {
    // Through a real config file: that is where Vitest merges root and project options, as it does for a plugin.
    const entry = fileURLToPath(new URL("./define-unit-config.ts", import.meta.url));
    const given = JSON.stringify({ coverage: { include: ["src/**/*.ts"] }, rootDir: root, ...options });
    fs.writeFileSync(
        path.join(root, "vitest.config.ts"),
        `import { defineUnitConfig } from ${JSON.stringify(entry)};\nexport default defineUnitConfig(${given});\n`,
    );
    const vitest = await createVitest({ root, watch: false, coverage: { enabled: false } }, { logLevel: "silent" });
    try {
        const specifications = await vitest.globTestSpecifications();
        return specifications.map((spec) => `${spec.project.name}:${spec.project.config.environment}:${path.relative(root, spec.moduleId)}`).sort();
    } finally {
        await vitest.close();
    }
}

describe("the projects Vitest builds from defineUnitConfig()", () => {
    it("without dom there is one run and every test file is in it", async () => {
        const files = await assignment({ include: ["src/**/*.test.ts"] });
        expect(files).toHaveLength(4);
        expect(new Set(files.map((entry) => entry.split(":")[0])).size).toBe(1);
        expect(files.every((entry) => entry.split(":")[1] === "node")).toBe(true);
    });

    it("each file is in exactly one project: dom globs in dom, everything else in unit", async () => {
        expect(await assignment({ dom: ["src/ui/**/*.test.ts"] })).toEqual([
            "dom:jsdom:src/ui/c.test.ts",
            "dom:jsdom:src/ui/d.test.ts",
            "unit:node:src/core/a.test.ts",
            "unit:node:src/core/b.test.ts",
        ]);
    });

    it("a custom include is honoured by the unit project: a file outside src that matches it runs in node", async () => {
        expect(
            await assignment({ include: ["src/**/*.test.ts", "scripts/**/*.test.ts"], dom: ["src/ui/**/*.test.ts"] }),
        ).toEqual([
            "dom:jsdom:src/ui/c.test.ts",
            "dom:jsdom:src/ui/d.test.ts",
            "unit:node:scripts/e.test.ts",
            "unit:node:src/core/a.test.ts",
            "unit:node:src/core/b.test.ts",
        ]);
    });

    it("dom: 'all' is a single jsdom run of every file", async () => {
        const files = await assignment({ dom: "all" });
        expect(files).toHaveLength(4);
        expect(files.every((entry) => entry.split(":")[1] === "jsdom")).toBe(true);
    });
});
