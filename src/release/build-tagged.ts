import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ResolvedBuild } from "../build/options.js";
import { buildOnce } from "./build-check.js";
import { extractCommittedTree } from "./committed-tree.js";
import type { RunGit } from "./git.js";
import type { CleanupSet } from "./interrupt.js";

/** The files a release of the tagged commit must carry, as this machine builds them. */
export interface TaggedBuild {
    readonly commit: string;
    readonly mainJs: Buffer;
    /** Undefined when the plugin has no CSS. */
    readonly css: Buffer | undefined;
    /** The `manifest.json` committed at the plugin root of the tag. */
    readonly manifest: Buffer;
}

export interface TaggedBuildInput {
    readonly cwd: string;
    readonly run: RunGit;
    readonly version: string;
    readonly build: ResolvedBuild;
    readonly cleanups: CleanupSet;
}

const readIfPresent = (file: string): Buffer | undefined => {
    try {
        return readFileSync(file);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
};

/**
 * A production build of the commit the tag points at: `git archive <tag>` extracted to a temp folder, built with
 * the options of `opdk build`, the same way the reproducibility check builds the committed tree. The release assets
 * must equal these bytes, which also proves the workflow built the tag and nothing else. The temp folder is removed
 * when this returns, fails, or Ctrl+C arrives.
 */
export async function buildTagged({ cwd, run, version, build, cleanups }: TaggedBuildInput): Promise<TaggedBuild> {
    // The real path: esbuild writes `../..` paths for files it reaches through the /var -> /private/var symlink of macOS.
    const workDir = mkdtempSync(path.join(realpathSync(tmpdir()), "opdk-release-"));
    const remove = (): void => {
        rmSync(workDir, { recursive: true, force: true });
    };
    const unregister = cleanups.add(remove);
    try {
        const tree = await extractCommittedTree({ cwd, run, workDir, overlay: [], ref: `refs/tags/${version}` });
        if (tree.kind === "unavailable") {
            throw new Error(`the tag ${version} cannot be built for the comparison: ${tree.reason}.${tree.hint === undefined ? "" : ` ${tree.hint}`}`);
        }
        const outDir = path.join(workDir, "out");
        mkdirSync(outDir);
        const outcome = await buildOnce(tree.dir, build, outDir, { preserveSymlinks: true });
        if (!outcome.ok) {
            throw new Error(`the tag ${version} does not build: ${outcome.problem.message}${(outcome.problem.details ?? []).map((line) => `\n${line}`).join("")}`);
        }
        const committedCss = readIfPresent(path.resolve(tree.dir, build.css === false ? "styles.css" : build.css.outfile));
        const manifest = readIfPresent(path.join(tree.dir, "manifest.json"));
        if (manifest === undefined) {
            throw new Error(`the tag ${version} has no manifest.json at the plugin root.`);
        }
        return { commit: tree.commit, mainJs: outcome.built.mainJs, css: outcome.built.css ?? committedCss, manifest };
    } finally {
        unregister();
        remove();
    }
}
