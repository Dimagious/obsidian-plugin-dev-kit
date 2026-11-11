import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBuild } from "../build/options.js";
import { createReleaseRepo, type ReleaseRepo } from "../test-support/release-fixture.js";
import { buildTagged } from "./build-tagged.js";
import { CleanupSet } from "./interrupt.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: ReleaseRepo | undefined;
let tmp: string;
const savedTmpdir = process.env.TMPDIR;
beforeEach(() => {
    // The build makes its temp folder under os.tmpdir(): point that at a folder of this test so a leak is visible.
    tmp = mkdtempSync(path.join(tmpdir(), "opdk-build-tagged-test-"));
    process.env.TMPDIR = tmp;
});
afterEach(() => {
    repo?.cleanup();
    repo = undefined;
    if (savedTmpdir === undefined) {
        delete process.env.TMPDIR;
    } else {
        process.env.TMPDIR = savedTmpdir;
    }
    rmSync(tmp, { recursive: true, force: true });
});

const leftovers = (): string[] => readdirSync(tmp);

describe("buildTagged", () => {
    it("builds the tagged commit, not the working tree, and returns the committed manifest", async () => {
        repo = createReleaseRepo();
        const build = resolveBuild(undefined);
        const first = await buildTagged({ cwd: repo.dir, run: repo.run, version: "1.0.0", build, cleanups: new CleanupSet() });

        // The tag moves on: a new commit changes the source, and an untracked file appears.
        repo.write("src/main.ts", 'export default class FixturePlugin {\n    hello(): string {\n        return "changed";\n    }\n}\n');
        repo.write("untracked.txt", "x");
        repo.commitAll("change");
        const again = await buildTagged({ cwd: repo.dir, run: repo.run, version: "1.0.0", build, cleanups: new CleanupSet() });

        expect(first.mainJs.toString("utf8")).toContain("hello");
        expect(again.mainJs.equals(first.mainJs)).toBe(true);
        expect(first.mainJs.toString("utf8")).not.toContain("changed");
        expect(first.css?.toString("utf8")).toContain(".fixture");
        expect(first.manifest.toString("utf8")).toBe(repo.git("show", "1.0.0:manifest.json"));
        expect(first.commit).toBe(repo.git("rev-parse", "--short", "1.0.0^{commit}").trim());
        expect(leftovers()).toEqual([]);
    });

    it("fails with a message for a tag that does not exist", async () => {
        repo = createReleaseRepo();
        await expect(buildTagged({ cwd: repo.dir, run: repo.run, version: "9.9.9", build: resolveBuild(undefined), cleanups: new CleanupSet() })).rejects.toThrow("the tag 9.9.9 cannot be built for the comparison: the repository has no commit refs/tags/9.9.9.");
    });

    it("fails with the build error when the tagged commit does not build", async () => {
        repo = createReleaseRepo();
        repo.write("src/main.ts", 'import "./missing.js";\nexport default class A {}\n');
        repo.commitAll("break the build");
        repo.git("tag", "-a", "1.0.1", "-m", "1.0.1");
        await expect(buildTagged({ cwd: repo.dir, run: repo.run, version: "1.0.1", build: resolveBuild(undefined), cleanups: new CleanupSet() })).rejects.toThrow(/the tag 1\.0\.1 does not build: the production build failed with 1 error/);
        expect(leftovers()).toEqual([]);
    });
});
