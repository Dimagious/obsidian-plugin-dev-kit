import { afterEach, describe, expect, it } from "vitest";
import { lockText, NEW_SHA, OLD_SHA, packageJsonText, workflowText } from "../test-support/kit-fixture.js";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { writePluginFiles } from "../test-support/release-fixture.js";
import { ALL_CHECKS, runReleaseCheck } from "./check.js";

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

interface Layout {
    readonly tag?: string;
    readonly lockSha?: string;
    readonly lockVersion?: string;
    readonly workflows?: Readonly<Record<string, readonly [sha: string, comment: string | undefined]>>;
}

/** A releasable plugin that uses the kit as `layout` says: tag in package.json, commit in the lockfile, pins in the workflows. */
function pluginWith(layout: Layout): PluginFixture {
    const created = createPluginFixture();
    plugin = created;
    writePluginFiles(created);
    const pkg = JSON.parse(packageJsonText(layout.tag ?? "v0.1.0")) as Record<string, unknown>;
    created.write("package.json", `${JSON.stringify({ ...pkg, name: "fixture-release", scripts: { build: "opdk build" } }, null, 2)}\n`);
    const lock = JSON.parse(lockText(layout.lockSha ?? OLD_SHA, layout.lockVersion ?? "0.1.0")) as Record<string, unknown>;
    created.write("package-lock.json", `${JSON.stringify({ ...lock, name: "fixture-release" }, null, 2)}\n`);
    for (const [file, [sha, comment]] of Object.entries(layout.workflows ?? {})) {
        created.write(`.github/workflows/${file}`, workflowText(file.replace(/^ci/, "plugin-ci"), sha, comment));
    }
    return created;
}

async function check(created: PluginFixture): Promise<{ code: number; out: string; err: string }> {
    const ctx = createContext(created.dir);
    const code = await runReleaseCheck({ cwd: created.dir, config: {}, tag: undefined, flags: { ...ALL_CHECKS, build: false, api: false }, reporter: ctx.reporter });
    return { code, out: ctx.out.join(""), err: ctx.err.join("") };
}

describe("release check, kit step", () => {
    it("passes when the tag, the lockfile and every workflow name one release", async () => {
        const result = await check(pluginWith({ workflows: { "ci.yml": [OLD_SHA, "v0.1.0"], "release.yml": [OLD_SHA, "v0.1.0"] } }));
        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ check   kit: the kit is v0.1.0 (6e33ca4) in package.json, package-lock.json, 2 workflow lines");
    });

    it("passes for a plugin that does not use the kit at all", async () => {
        const created = createPluginFixture();
        plugin = created;
        writePluginFiles(created);
        const result = await check(created);
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ check   kit: obsidian-plugin-dev-kit is not a git dependency and no workflow calls it");
    });

    it("passes for a plugin that depends on the kit but calls none of its workflows", async () => {
        const result = await check(pluginWith({}));
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ check   kit: the kit is v0.1.0 (6e33ca4) in package.json, package-lock.json");
    });

    it("fails when package.json and the lockfile name different releases, listing every place and the fix", async () => {
        const result = await check(pluginWith({ tag: "v0.2.0", workflows: { "ci.yml": [OLD_SHA, "v0.1.0"] } }));
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ check   kit: the kit is not pinned to one release.");
        expect(result.err).toContain("package.json asks for v0.2.0, but the lockfile holds kit version 0.1.0.");
        expect(result.err).toContain("package.json (devDependencies): v0.2.0");
        expect(result.err).toContain("package-lock.json: commit 6e33ca4, version 0.1.0");
        expect(result.err).toContain(".github/workflows/ci.yml:6: commit 6e33ca4 (# v0.1.0)");
        expect(result.err).toContain("Run `opdk kit upgrade v0.2.0`");
    });

    it("fails when one workflow names another commit", async () => {
        const result = await check(pluginWith({ workflows: { "ci.yml": [OLD_SHA, "v0.1.0"], "release.yml": [NEW_SHA, "v0.1.0"] } }));
        expect(result.code).toBe(1);
        expect(result.err).toContain("the places below name 2 different commits of the kit.");
        expect(result.err).toContain(".github/workflows/release.yml:6: commit a1b2c3d (# v0.1.0)");
    });

    it("fails when a comment says another tag than the one pinned", async () => {
        const result = await check(pluginWith({ workflows: { "ci.yml": [OLD_SHA, "v0.2.0"] } }));
        expect(result.code).toBe(1);
        expect(result.err).toContain(".github/workflows/ci.yml:6 says # v0.2.0, but the kit is at 0.1.0.");
    });

    it("fails on a workflow pinned to a tag instead of a commit", async () => {
        const result = await check(pluginWith({ workflows: { "ci.yml": ["v0.1.0", undefined] } }));
        expect(result.code).toBe(1);
        expect(result.err).toContain('pins the kit\'s workflow to "v0.1.0", not to a full commit SHA.');
    });

    it("runs in the --no-build --no-api mode CI uses", async () => {
        const created = pluginWith({ workflows: { "ci.yml": [NEW_SHA, "v0.1.0"] } });
        const result = await check(created);
        expect(result.out).toContain("· check   build: skipped (--no-build)");
        expect(result.code).toBe(1);
    });
});
