import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { createReleaseRepo, hermeticGitEnv, type ReleaseRepo } from "../test-support/release-fixture.js";
import { extractCommittedTree, isLinkableEntry, unsupportedInstallLayout, type EntryLike } from "./committed-tree.js";
import { createRunGit } from "./git.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: ReleaseRepo | undefined;
let plain: PluginFixture | undefined;
afterEach(() => {
    repo?.cleanup();
    plain?.cleanup();
    repo = undefined;
    plain = undefined;
});

function freshRepo(): ReleaseRepo {
    repo = createReleaseRepo();
    return repo;
}

/** A work folder next to the plugin, inside the repository fixture's own temp root. */
function workDir(current: ReleaseRepo): string {
    const dir = path.join(path.dirname(current.dir), "work");
    mkdirSync(dir);
    return dir;
}

describe("extractCommittedTree", () => {
    it("extracts the given ref instead of HEAD, and says so when the ref does not exist", async () => {
        const current = freshRepo();
        current.write("src/main.ts", "export default class Later {}\n");
        current.commitAll("later");
        const work = workDir(current);
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: work, overlay: [], ref: "refs/tags/1.0.0" });
        expect(tree.kind).toBe("ready");
        if (tree.kind === "ready") {
            expect(readFileSync(path.join(tree.dir, "src/main.ts"), "utf8")).toContain("FixturePlugin");
            expect(tree.commit).toBe(current.git("rev-parse", "--short", "1.0.0^{commit}").trim());
        }
        const missing = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: path.join(work, "x"), overlay: [], ref: "refs/tags/nope" });
        expect(missing).toEqual({ kind: "unavailable", reason: "the repository has no commit refs/tags/nope" });
    });

    it("extracts HEAD at another path, without untracked or ignored files, and links the packages of node_modules", async () => {
        const current = freshRepo();
        current.write("node_modules/dep/index.js", "module.exports = 1;\n");
        current.write("node_modules/@scope/pkg/index.js", "module.exports = 2;\n");
        current.write("node_modules/.bin/tool", "#!/bin/sh\n");
        current.write("untracked.txt", "x");
        current.write("src/main.ts", "export default class Edited {}\n");
        const work = workDir(current);
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: work, overlay: [] });

        expect(tree.kind).toBe("ready");
        if (tree.kind !== "ready") {
            return;
        }
        expect(tree.dir).toBe(path.join(work, "plugin-copy"));
        expect(tree.commit).toBe(current.git("rev-parse", "--short", "HEAD").trim());
        // The committed text, not the edit in the working tree.
        expect(readFileSync(path.join(tree.dir, "src/main.ts"), "utf8")).toContain("FixturePlugin");
        expect(existsSync(path.join(tree.dir, "untracked.txt"))).toBe(false);
        expect(existsSync(path.join(tree.dir, ".git"))).toBe(false);
        // The folder is real and each package in it is a link: a linked folder would show its real path in the bundle.
        expect(lstatSync(path.join(tree.dir, "node_modules")).isSymbolicLink()).toBe(false);
        expect(lstatSync(path.join(tree.dir, "node_modules/dep")).isSymbolicLink()).toBe(true);
        expect(lstatSync(path.join(tree.dir, "node_modules/@scope")).isSymbolicLink()).toBe(false);
        expect(lstatSync(path.join(tree.dir, "node_modules/@scope/pkg")).isSymbolicLink()).toBe(true);
        expect(readFileSync(path.join(tree.dir, "node_modules/dep/index.js"), "utf8")).toBe("module.exports = 1;\n");
        expect(readFileSync(path.join(tree.dir, "node_modules/@scope/pkg/index.js"), "utf8")).toBe("module.exports = 2;\n");
        expect(existsSync(path.join(tree.dir, "node_modules/.bin"))).toBe(false);
        expect(tree.uncommitted).toEqual([" M src/main.ts", "?? untracked.txt"]);
    });

    it("lays the overlay over the copy and leaves the overlay's own files out of the uncommitted list", async () => {
        const current = freshRepo();
        current.write("manifest.json", '{"version":"9.9.9"}\n');
        current.write("versions.json", "{}\n");
        current.write("brand-new.json", "{}\n");
        const tree = await extractCommittedTree({
            cwd: current.dir,
            run: current.run,
            workDir: workDir(current),
            overlay: [
                { path: "manifest.json", content: '{"version":"9.9.9"}\n' },
                { path: "nested/new.json", content: "{}\n" },
            ],
        });
        expect(tree.kind === "ready" ? readFileSync(path.join(tree.dir, "manifest.json"), "utf8") : "").toBe('{"version":"9.9.9"}\n');
        expect(tree.kind === "ready" ? readFileSync(path.join(tree.dir, "nested/new.json"), "utf8") : "").toBe("{}\n");
        expect(tree.kind === "ready" ? tree.uncommitted : []).toEqual([" M versions.json", "?? brand-new.json"]);
    });

    it("archives only the plugin folder when the plugin lives in a subfolder of the repository", async () => {
        const current = freshRepo();
        current.write("packages/plugin/manifest.json", "{}\n");
        current.write("packages/plugin/src/a.ts", "export const a = 1;\n");
        current.commitAll("monorepo");
        const sub = path.join(current.dir, "packages", "plugin");
        const tree = await extractCommittedTree({ cwd: sub, run: createRunGit(sub, hermeticGitEnv()), workDir: workDir(current), overlay: [] });
        expect(tree.kind).toBe("ready");
        if (tree.kind === "ready") {
            expect(existsSync(path.join(tree.dir, "src/a.ts"))).toBe(true);
            expect(existsSync(path.join(tree.dir, "CHANGELOG.md"))).toBe(false);
        }
    });

    it("says why there is no committed tree outside a repository and before the first commit", async () => {
        const created = createPluginFixture();
        plain = created;
        const run = createRunGit(created.dir, hermeticGitEnv());
        const outside = await extractCommittedTree({ cwd: created.dir, run, workDir: created.dir, overlay: [] });
        expect(outside).toEqual({ kind: "unavailable", reason: "the folder is not inside a git repository" });

        await run(["init", "--quiet", "-b", "main"]);
        const empty = await extractCommittedTree({ cwd: created.dir, run, workDir: created.dir, overlay: [] });
        expect(empty).toEqual({ kind: "unavailable", reason: "the repository has no commit yet" });
    });

    it("throws when the work folder does not exist", async () => {
        const current = freshRepo();
        await expect(extractCommittedTree({ cwd: current.dir, run: current.run, workDir: path.join(path.dirname(current.dir), "no-such-folder"), overlay: [] })).rejects.toThrow(/ENOENT/);
    });

    it("does not link a node_modules the plugin does not have", async () => {
        const current = freshRepo();
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: workDir(current), overlay: [] });
        expect(tree.kind === "ready" && existsSync(path.join(tree.dir, "node_modules"))).toBe(false);
    });

    it("keeps a node_modules that the commit itself contains", async () => {
        const current = freshRepo();
        current.write("node_modules/committed.js", "1\n");
        current.git("add", "-f", "node_modules/committed.js");
        current.git("commit", "--quiet", "-m", "vendored");
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: workDir(current), overlay: [] });
        expect(tree.kind === "ready" && existsSync(path.join(tree.dir, "node_modules/committed.js"))).toBe(true);
    });
});

describe("isLinkableEntry", () => {
    const entry = (name: string, kind: "dir" | "file" | "link"): EntryLike => ({ name, isDirectory: () => kind === "dir", isSymbolicLink: () => kind === "link" });

    it("links folders and symlinks, and skips .bin and plain files (a Windows junction can only point at a folder)", () => {
        expect(isLinkableEntry(entry("dep", "dir"))).toBe(true);
        expect(isLinkableEntry(entry("@scope", "dir"))).toBe(true);
        expect(isLinkableEntry(entry("linked-workspace", "link"))).toBe(true);
        expect(isLinkableEntry(entry(".bin", "dir"))).toBe(false);
        expect(isLinkableEntry(entry(".package-lock.json", "file"))).toBe(false);
        expect(isLinkableEntry(entry(".modules.yaml", "file"))).toBe(false);
    });

    it("leaves plain files out of the linked node_modules", async () => {
        const current = freshRepo();
        current.write("node_modules/dep/index.js", "1\n");
        current.write("node_modules/.package-lock.json", "{}\n");
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: workDir(current), overlay: [] });
        expect(tree.kind === "ready" && existsSync(path.join(tree.dir, "node_modules/dep"))).toBe(true);
        expect(tree.kind === "ready" && existsSync(path.join(tree.dir, "node_modules/.package-lock.json"))).toBe(false);
    });
});

describe("install layouts the committed tree cannot be built for", () => {
    it("names pnpm and Yarn PnP, and nothing for npm", () => {
        const has = (...present: string[]) => (relative: string): boolean => present.includes(relative);
        expect(unsupportedInstallLayout(has("node_modules/.pnpm"))).toBe("pnpm install");
        expect(unsupportedInstallLayout(has("node_modules/.modules.yaml"))).toBe("pnpm install");
        expect(unsupportedInstallLayout(has(".pnp.cjs"))).toBe("Yarn PnP install");
        expect(unsupportedInstallLayout(has(".pnp.js"))).toBe("Yarn PnP install");
        expect(unsupportedInstallLayout(has("node_modules", "package-lock.json"))).toBeUndefined();
    });

    it("is unavailable for a pnpm-shaped node_modules, with a reason that names the layout", async () => {
        const current = freshRepo();
        current.write("node_modules/.pnpm/a@1/node_modules/a/index.js", "require('b');\n");
        current.write("node_modules/.pnpm/a@1/node_modules/b/index.js", "1\n");
        symlinkSync(path.join(current.dir, "node_modules/.pnpm/a@1/node_modules/a"), path.join(current.dir, "node_modules/a"), "junction");
        const work = workDir(current);
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: work, overlay: [] });
        expect(tree.kind).toBe("unavailable");
        if (tree.kind === "unavailable") {
            expect(tree.reason).toContain("pnpm install: compared two builds of the working tree, not the committed tree");
            expect(tree.hint).toContain("npm ci");
        }
        expect(existsSync(path.join(work, "plugin-copy"))).toBe(false);
    });

    it("is unavailable for a Yarn PnP install", async () => {
        const current = freshRepo();
        current.write(".pnp.cjs", "module.exports = {};\n");
        const tree = await extractCommittedTree({ cwd: current.dir, run: current.run, workDir: workDir(current), overlay: [] });
        expect(tree.kind === "unavailable" && tree.reason).toContain("Yarn PnP install: compared two builds of the working tree");
    });
});
