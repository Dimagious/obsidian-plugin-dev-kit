import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBuild } from "../build/options.js";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { writePluginFiles } from "../test-support/release-fixture.js";
import { checkBuild, committedBuildHint, type BuildCheckInput } from "./build-check.js";
import { runReleaseCheck } from "./check.js";
import { CleanupSet } from "./interrupt.js";

// A bundler whose output changes with every call, as one that inlines a timestamp would: the real esbuild is deterministic.
let calls = 0;
vi.mock("esbuild", async (importOriginal) => {
    const original = await importOriginal<typeof import("esbuild")>();
    return {
        ...original,
        build: vi.fn((options: { outfile?: string }) => {
            calls++;
            writeFileSync(options.outfile ?? "", `var built = ${String(calls)};\n`);
            return Promise.resolve({ errors: [], warnings: [] });
        }),
    };
});

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
    calls = 0;
});

describe("the reproducibility check", () => {
    it("fails with the first differing offset and the likely causes when two builds differ", async () => {
        const created = createPluginFixture();
        plugin = created;
        writePluginFiles(created);
        const ctx = createContext(created.dir);
        const code = await runReleaseCheck({ cwd: created.dir, config: {}, tag: undefined, flags: { build: true, reproducible: true, api: false }, reporter: ctx.reporter });
        const err = ctx.err.join("");
        expect(code).toBe(1);
        expect(err).toContain("reproducible: main.js differs between two builds of the working tree: first difference at byte 12 (line 1, column 13), 15 and 15 bytes;");
        expect(err).toContain("Likely causes: a timestamp");
        expect(err).toContain("cannot see files git does not hold or absolute paths");
        // Not a git repository: said as a warning, next to the failure.
        expect(ctx.out.join("")).toContain("! check   reproducible: the folder is not inside a git repository, so the committed tree could not be compared");
        // Two builds and nothing else is wrong: the first build alone passed.
        expect(ctx.out.join("")).toContain("✓ check   build:");
        expect(ctx.out.join("")).toContain("✓ check   assets:");
        expect(calls).toBe(2);
    });

    it("builds once when --no-reproducible is given", async () => {
        const created = createPluginFixture();
        plugin = created;
        writePluginFiles(created);
        const ctx = createContext(created.dir);
        const code = await runReleaseCheck({ cwd: created.dir, config: {}, tag: undefined, flags: { build: true, reproducible: false, api: false }, reporter: ctx.reporter });
        expect(code).toBe(0);
        expect(calls).toBe(1);
    });
});

describe("the reproducibility check against the committed tree", () => {
    function input(options: Partial<BuildCheckInput>): BuildCheckInput {
        const created = createPluginFixture();
        plugin = created;
        writePluginFiles(created);
        return { cwd: created.dir, manifestText: "{}", desktopOnly: false, build: resolveBuild(undefined), reproducible: true, buildNotes: [], cleanups: new CleanupSet(), ...options };
    }

    it("compares with the build of the committed tree and says which commit and what is not compared", async () => {
        const copy = createPluginFixture();
        const results = await checkBuild(
            input({ committed: () => Promise.resolve({ kind: "ready", dir: copy.dir, commit: "abc1234", uncommitted: [" M src/a.ts", "?? b.ts", "?? c.ts", "?? d.ts"] }) }),
        );
        copy.cleanup();
        const [problem] = results.find((result) => result.group === "reproducible")?.problems ?? [];
        expect(problem?.severity).toBe("error");
        expect(problem?.message).toContain("main.js differs between the working-tree build and a build of the committed tree (HEAD abc1234) extracted to another folder: first difference at byte");
        expect(problem?.hint).toContain("a file the build reads that git does not hold");
        expect(problem?.hint).toContain("Not compared: the Node and esbuild versions");
        expect(problem?.hint).toContain("The working tree has 4 uncommitted change(s) (M src/a.ts, ?? b.ts, ?? c.ts, ...): commit them first");
    });

    it("reports a committed tree that cannot be extracted as an error that names the cause", async () => {
        const results = await checkBuild(input({ committed: () => Promise.reject(new Error("tar could not extract the committed tree: bad archive")) }));
        const problems = results.find((result) => result.group === "reproducible")?.problems ?? [];
        expect(problems).toHaveLength(1);
        expect(problems[0]?.severity).toBe("error");
        expect(problems[0]?.message).toContain("bad archive");
        expect(problems[0]?.hint).toContain("--no-reproducible");
        expect(calls).toBe(1);
    });

    it("falls back to two builds of the working tree with a warning that names the layout and carries its hint", async () => {
        const results = await checkBuild(
            input({ committed: () => Promise.resolve({ kind: "unavailable", reason: "pnpm install: compared two builds of the working tree, not the committed tree (its packages cannot be linked into a copy)", hint: "Use an npm layout." }) }),
        );
        const problems = results.find((result) => result.group === "reproducible")?.problems ?? [];
        const warning = problems.find((problem) => problem.severity === "warning");
        expect(warning?.message).toContain("pnpm install: compared two builds of the working tree, not the committed tree");
        expect(warning?.message).not.toContain("so the committed tree could not be compared");
        expect(warning?.hint).toBe("Use an npm layout.");
        expect(problems.find((problem) => problem.severity === "error")?.message).toContain("between two builds of the working tree");
    });

    it("attaches the build notes to the build group", async () => {
        const note = { group: "build" as const, severity: "warning" as const, message: "the script is not opdk build" };
        const ok = await checkBuild(input({ reproducible: false, buildNotes: [note] }));
        expect(ok.find((result) => result.group === "build")?.problems).toEqual([note]);
    });
});

describe("committedBuildHint", () => {
    it("blames the commit for a missing relative file and the dependency layout for a package", () => {
        expect(committedBuildHint("the production build failed", ['Could not resolve "./generated"'])).toContain("not in the commit");
        expect(committedBuildHint("the production build failed", ['Could not resolve "lodash"'])).toContain("dependency layout");
        expect(committedBuildHint("the production build failed", ['Could not resolve "@scope/pkg"'])).toContain("dependency layout");
        expect(committedBuildHint("the production build failed", ['Could not resolve "../node_modules/x/y.js"', "node_modules/x/y.js:1"])).toContain("dependency layout");
        expect(committedBuildHint("the CSS step failed", undefined)).toContain("not in the commit");
    });
});
