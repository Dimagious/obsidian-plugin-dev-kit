import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { createReleaseRepo, hermeticGitEnv, VALID_MANIFEST, writePluginFiles, type ReleaseRepo } from "../test-support/release-fixture.js";
import { createRunGit } from "./git.js";
import { ALL_CHECKS, runReleaseCheck, type CheckFlags } from "./check.js";
import type { OpdkConfig } from "../config/types.js";

// Real esbuild runs: they miss the 5 s default when suites share the machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const NO_API: CheckFlags = { ...ALL_CHECKS, api: false };

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

function releasablePlugin(): PluginFixture {
    const created = createPluginFixture();
    plugin = created;
    writePluginFiles(created);
    return created;
}

/** A JSON file the way opdk writes it: the check refuses one on a single line. */
function pretty(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

async function check(options: { flags?: CheckFlags; tag?: string; config?: OpdkConfig } = {}): Promise<{ code: number; out: string; err: string }> {
    const current = plugin ?? releasablePlugin();
    const ctx = createContext(current.dir);
    const code = await runReleaseCheck({ cwd: current.dir, config: options.config ?? {}, tag: options.tag, flags: options.flags ?? NO_API, reporter: ctx.reporter });
    return { code, out: ctx.out.join(""), err: ctx.err.join("") };
}

describe("opdk release check on a releasable plugin", () => {
    it("exits 0 with a ✓ line per group and leaves the plugin folder untouched", async () => {
        const created = releasablePlugin();
        const result = await check();
        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(result.out).toContain("· check   fixture-release 1.0.0");
        expect(result.out).toContain("✓ check   versions: manifest.json, package.json and package-lock.json are all 1.0.0");
        expect(result.out).toContain("✓ check   versions.json: 1.0.0 maps to 1.5.0");
        expect(result.out).toContain("✓ check   manifest: manifest.json follows the directory's rules");
        expect(result.out).toContain("✓ check   changelog: CHANGELOG.md has a section for 1.0.0");
        expect(result.out).toMatch(/✓ check {3}build: production build of src\/main\.ts: main\.js \d+\.\d KiB, free of Node-only references/);
        expect(result.out).toContain("✓ check   assets: main.js, manifest.json, styles.css (built)");
        // The plugin fixture is not a git repository, so the fallback ran and said so.
        expect(result.out).toContain("! check   reproducible: the folder is not inside a git repository, so the committed tree could not be compared");
        expect(result.out).toContain("✓ check   reproducible: main.js, styles.css identical byte for byte between two builds of the working tree");
        expect(result.out).toContain("· check   api: skipped (--no-api)");
        expect(result.out).toContain("✓ check   fixture-release 1.0.0: ready to release.");
        // The builds went to temp folders.
        expect(() => readFileSync(path.join(created.dir, "main.js"))).toThrow();
        expect(() => readFileSync(path.join(created.dir, "styles.css"))).toThrow();
    });

    it("notes the tag it compared with", async () => {
        const result = await check({ tag: "1.0.0", flags: { ...NO_API, build: false } });
        expect(result.out).toContain("· check   fixture-release 1.0.0 (tag 1.0.0)");
        expect(result.out).toContain("manifest.json, package.json and package-lock.json are all 1.0.0, tag 1.0.0 matches");
    });
});

describe("skipping", () => {
    it("--no-build skips build, assets and reproducible, and says so", async () => {
        const result = await check({ flags: { build: false, reproducible: true, api: false } });
        expect(result.code).toBe(0);
        for (const group of ["build", "assets", "reproducible"]) {
            expect(result.out).toContain(`· check   ${group}: skipped (--no-build)`);
        }
        expect(result.out).not.toContain("✓ check   build:");
    });

    it("--no-reproducible builds once", async () => {
        const result = await check({ flags: { build: true, reproducible: false, api: false } });
        expect(result.out).toContain("· check   reproducible: skipped (--no-reproducible)");
        expect(result.out).toContain("✓ check   assets:");
    });
});

describe("failures", () => {
    it("fails on a version that differs, one ✗ line with a hint", async () => {
        const created = releasablePlugin();
        created.write("package.json", pretty({ name: "p", version: "1.0.1" }));
        const result = await check({ flags: { ...NO_API, build: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ check   versions: package.json is 1.0.1 but manifest.json is 1.0.0.");
        expect(result.err).toContain("Make the versions equal");
        expect(result.err).toContain("✗ check   fixture-release 1.0.0: 1 problem(s), not ready to release.");
        expect(result.out).not.toContain("ready to release.");
    });

    it("fails when the tag differs from the version", async () => {
        const result = await check({ tag: "v1.0.0", flags: { ...NO_API, build: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain('versions: tag "v1.0.0" does not match manifest.json version 1.0.0: Obsidian release tags have no "v" prefix.');
    });

    it("fails on a file that the release would refuse to rewrite, and passes again in the written format", async () => {
        const created = releasablePlugin();
        const cases: [string, string, string][] = [
            ["versions.json", '{"1.0.0": "1.5.0"}', "versions.json: versions.json is not formatted"],
            ["package.json", '{"name":"fixture-release","version":"1.0.0","private":true,"scripts":{"build":"opdk build"}}', "versions: package.json is not formatted"],
            ["package-lock.json", '{"name":"fixture-release","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture-release","version":"1.0.0"}}}', "versions: package-lock.json is not formatted"],
            ["manifest.json", JSON.stringify(VALID_MANIFEST), "versions: manifest.json is not formatted"],
        ];
        for (const [name, bad, expected] of cases) {
            const good = readFileSync(path.join(created.dir, name), "utf8");
            created.write(name, bad);
            const failed = await check({ flags: { ...NO_API, build: false } });
            expect(failed.code, name).toBe(1);
            expect(failed.err, name).toContain(expected);
            expect(failed.err, name).toContain("node -e");
            expect(failed.err, name).toContain("1 problem(s), not ready to release.");
            created.write(name, good);
            expect((await check({ flags: { ...NO_API, build: false } })).code, name).toBe(0);
        }
    });

    it("reports every problem, not only the first", async () => {
        const created = releasablePlugin();
        created.write("manifest.json", pretty({ ...VALID_MANIFEST, name: "Obsidian Words", version: "1.0.0" }));
        created.write("versions.json", "{}");
        created.write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n- Something.\n");
        const result = await check({ flags: { ...NO_API, build: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain("manifest: manifest.json: name \"Obsidian Words\" must not contain \"obsidian\".");
        expect(result.err).toContain("versions.json: versions.json has no entry for 1.0.0.");
        expect(result.err).toContain('changelog: CHANGELOG.md has no "## [1.0.0]" section.');
        expect(result.err).toContain("3 problem(s)");
    });

    it("prints warnings as ! lines that do not fail the check", async () => {
        const created = releasablePlugin();
        created.write("manifest.json", pretty({ ...VALID_MANIFEST, homepage: "https://example.com" }));
        const result = await check({ flags: { ...NO_API, build: false } });
        expect(result.code).toBe(0);
        expect(result.out).toContain('! check   manifest: manifest.json: unknown field "homepage".');
        expect(result.out).toContain("✓ check   manifest:");
    });

    it("fails with the esbuild messages when the build breaks", async () => {
        const created = releasablePlugin();
        created.write("src/main.ts", 'import "./missing.js";\nexport default class A {}\n');
        const result = await check();
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ check   build: the production build failed with 1 error(s).");
        expect(result.err).toContain("Could not resolve");
        expect(result.out).not.toContain("assets:");
    });

    it("fails when the CSS entry imports a file that is missing", async () => {
        const created = releasablePlugin();
        created.write("src/styles/main.css", '@import "./nope.css";\n');
        const result = await check();
        expect(result.code).toBe(1);
        expect(result.err).toContain("build: the CSS step failed");
    });

    it("fails on code that only runs under Node, unless the plugin is desktop only", async () => {
        const created = releasablePlugin();
        created.write("src/main.ts", "export default class A { dir = __dirname; }\n");
        const failed = await check();
        expect(failed.code).toBe(1);
        expect(failed.err).toContain("build: main.js cannot run on mobile.");
        expect(failed.err).toContain("- ");

        created.write("manifest.json", pretty({ ...VALID_MANIFEST, isDesktopOnly: true }));
        const passed = await check();
        expect(passed.code).toBe(0);
        expect(passed.out).toMatch(/build: production build of src\/main\.ts: main\.js \d+\.\d KiB\n/);
    });

    it("fails on an empty stylesheet", async () => {
        const created = releasablePlugin();
        created.write("src/styles/main.css", "");
        const result = await check({ flags: { ...NO_API, reproducible: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain("assets: styles.css is empty.");
    });

    it("fails when the manifest next to a bundle built outside the root is another one", async () => {
        const created = releasablePlugin();
        created.write("dist/manifest.json", pretty({ ...VALID_MANIFEST, version: "0.9.0" }));
        const result = await check({ config: { build: { outfile: "dist/main.js" } }, flags: { ...NO_API, reproducible: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain("assets: the manifest.json next to dist/main.js differs from the one at the plugin root.");
    });

    it("keeps a hand-written styles.css when there is no CSS entry", async () => {
        const created = releasablePlugin();
        created.write("src/styles/main.css", "");
        // No entry file at all: remove it by pointing the entry elsewhere.
        created.write("styles.css", ".hand { color: blue; }\n");
        const result = await check({ config: { build: { css: { entry: "src/nothing.css" } } }, flags: { ...NO_API, reproducible: false } });
        expect(result.code).toBe(0);
        expect(result.out).toContain("assets: main.js, manifest.json, styles.css (as committed)");
    });

    it("reads the changelog path from the release config", async () => {
        const created = releasablePlugin();
        created.write("docs/CHANGES.md", "## [1.0.0] - 2026-01-01\n\n- First.\n");
        const result = await check({ config: { release: { changelog: "docs/CHANGES.md" } }, flags: { ...NO_API, build: false } });
        expect(result.code).toBe(0);
        expect(result.out).toContain("docs/CHANGES.md has a section for 1.0.0");
    });
});

describe("files that cannot be read", () => {
    it("stops at a manifest that is missing, invalid or not an object", async () => {
        const created = releasablePlugin();
        created.write("manifest.json", "{nope");
        expect((await check()).err).toContain("✗ check   manifest.json is not valid JSON");
        created.write("manifest.json", "[]");
        expect((await check()).err).toContain("manifest.json must contain a JSON object.");
    });

    it("reports a missing manifest.json", async () => {
        const created = createPluginFixture();
        plugin = created;
        const { rmSync } = await import("node:fs");
        rmSync(path.join(created.dir, "manifest.json"));
        const result = await check();
        expect(result.code).toBe(1);
        expect(result.err).toContain("manifest.json is missing in");
    });

    it("reports package.json and the lockfile that are missing or invalid", async () => {
        const created = releasablePlugin();
        const { rmSync } = await import("node:fs");
        rmSync(path.join(created.dir, "package.json"));
        created.write("package-lock.json", "{nope");
        const result = await check({ flags: { ...NO_API, build: false } });
        expect(result.code).toBe(1);
        expect(result.err).toContain("versions: package.json is missing.");
        expect(result.err).toContain("versions: package-lock.json is not valid JSON");
    });
});

describe("the reproducibility check in a git repository", () => {
    let repo: ReleaseRepo | undefined;
    afterEach(() => {
        repo?.cleanup();
        repo = undefined;
    });

    async function checkRepo(current: ReleaseRepo, config: OpdkConfig = {}): Promise<{ code: number; out: string; err: string }> {
        const ctx = createContext(current.dir);
        const code = await runReleaseCheck({ cwd: current.dir, config, tag: undefined, flags: NO_API, reporter: ctx.reporter, run: current.run });
        return { code, out: ctx.out.join(""), err: ctx.err.join("") };
    }

    function freshRepo(): ReleaseRepo {
        repo = createReleaseRepo();
        return repo;
    }

    it("builds the working tree and the committed tree at another path, and they match", async () => {
        const current = freshRepo();
        const result = await checkRepo(current);
        const head = current.git("rev-parse", "--short", "HEAD").trim();
        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(result.out).toContain(`✓ check   reproducible: main.js, styles.css identical byte for byte between the working-tree build and a build of the committed tree (HEAD ${head}) extracted to another folder\n`);
        expect(result.out).not.toContain("! check");
    });

    it("fails when an input of the build is ignored by git: the committed tree does not build", async () => {
        const current = freshRepo();
        current.write(".gitignore", "main.js\nstyles.css\nnode_modules\nsrc/generated.ts\n");
        current.write("src/generated.ts", "export const generated = 1;\n");
        current.write("src/main.ts", 'import { generated } from "./generated";\nexport default class FixturePlugin {\n    value = generated;\n}\n');
        current.commitAll("import a generated file");
        const result = await checkRepo(current);
        expect(result.code).toBe(1);
        expect(result.err).toMatch(/✗ check {3}reproducible: the committed tree \(HEAD [0-9a-f]+\) does not build, although the working tree does: the production build failed with 1 error\(s\)\./);
        expect(result.err).toContain("Could not resolve");
        expect(result.err).toContain("untracked, ignored by .gitignore or excluded by export-ignore");
    });

    it("fails when the output depends on an uncommitted change, and says the tree is not clean", async () => {
        const current = freshRepo();
        current.write("src/main.ts", "export default class Edited {}\n");
        const result = await checkRepo(current);
        expect(result.code).toBe(1);
        expect(result.err).toContain("reproducible: main.js differs between the working-tree build and a build of the committed tree");
        expect(result.err).toContain("The working tree has 1 uncommitted change(s) (M src/main.ts): commit them first");
    });

    it("passes with a note when files outside the build are uncommitted", async () => {
        const current = freshRepo();
        current.write("notes.txt", "scratch");
        const result = await checkRepo(current);
        expect(result.code).toBe(0);
        expect(result.out).toContain("; 1 uncommitted change(s) are not in the committed tree");
    });

    it("reaches the plugin's node_modules from the copy without its path showing in the output", async () => {
        const current = freshRepo();
        current.write("node_modules/dep/index.js", "module.exports = { dep: true };\n");
        current.write("src/main.ts", 'declare const require: (id: string) => unknown;\nexport default class FixturePlugin {\n    dep = require("dep");\n}\n');
        current.commitAll("use a dependency");
        // Not minified, so esbuild writes the module path into a comment: a symlink resolved to its target would put the real folder there.
        const result = await checkRepo(current, { build: { minify: false } });
        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(result.out).toContain("identical byte for byte between the working-tree build and a build of the committed tree");
    });

    it("warns, and still passes, when the build script the directory runs is not opdk build", async () => {
        const current = freshRepo();
        current.write("package.json", `${JSON.stringify({ name: "fixture-release", version: "1.0.0", private: true, scripts: { build: "node build.mjs" } }, null, 2)}\n`);
        current.commitAll("custom build script");
        const result = await checkRepo(current);
        expect(result.code).toBe(0);
        expect(result.out).toContain('! check   build: package.json scripts.build is "node build.mjs" and does not run `opdk build`.');
    });

    it("falls back to two builds of the working tree before the first commit", async () => {
        const created = createPluginFixture();
        plugin = created;
        writePluginFiles(created);
        const run = createRunGit(created.dir, hermeticGitEnv());
        await run(["init", "--quiet", "-b", "main"]);
        const ctx = createContext(created.dir);
        const code = await runReleaseCheck({ cwd: created.dir, config: {}, tag: undefined, flags: NO_API, reporter: ctx.reporter, run });
        expect(code).toBe(0);
        expect(ctx.out.join("")).toContain("! check   reproducible: the repository has no commit yet, so the committed tree could not be compared");
    });
});
