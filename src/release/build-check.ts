import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build as esbuildBuild, formatMessages } from "esbuild";
import { findNodeOnlyReferences } from "../build/bundle-check.js";
import { buildCss } from "../build/css.js";
import { toEsbuildOptions, type ResolvedBuild } from "../build/options.js";
import { formatKib, isBuildFailure } from "../build/report.js";
import { checkAssets } from "./assets.js";
import { loadText } from "./json.js";
import { errorProblem, warningProblem, type GroupResult, type Problem } from "./problems.js";
import type { CommittedTree } from "./committed-tree.js";
import type { CleanupSet } from "./interrupt.js";
import { describeDifference, firstDifference, LIKELY_CAUSES, LIKELY_CAUSES_SAME_TREE } from "./reproducible.js";

export interface BuildCheckInput {
    readonly cwd: string;
    /** Text of manifest.json at the plugin root. */
    readonly manifestText: string;
    readonly desktopOnly: boolean;
    readonly build: ResolvedBuild;
    /** Build a second time and compare the bytes. */
    readonly reproducible: boolean;
    /** Extracts the committed tree into the given empty folder. Without it the second build runs in the plugin folder. */
    readonly committed?: (workDir: string) => Promise<CommittedTree>;
    /** Findings about the build setup itself (the package.json script), reported with the `build` group. */
    readonly buildNotes: readonly Problem[];
    /** Where the temp folders are listed, so Ctrl+C can remove them. */
    readonly cleanups: CleanupSet;
}

interface Built {
    readonly mainJs: Buffer;
    /** Undefined when the plugin has no CSS entry. */
    readonly css: Buffer | undefined;
}

type BuildOutcome = { readonly ok: true; readonly built: Built } | { readonly ok: false; readonly problem: Problem };

const readBytes = (file: string): Buffer | undefined => {
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
 * One production build, written into `outDir` instead of the plugin folder: the check must not replace the
 * developer's own `main.js` or `styles.css`. The options are the ones `opdk build` uses (`toEsbuildOptions`, the
 * CSS bundler), with absolute output paths.
 */
async function buildOnce(cwd: string, build: ResolvedBuild, outDir: string, options: { readonly preserveSymlinks?: boolean } = {}): Promise<BuildOutcome> {
    const stylesFile = path.join(outDir, "styles.css");
    let css: Buffer | undefined;
    if (build.css !== false) {
        try {
            const result = buildCss(cwd, { entry: build.css.entry, outfile: stylesFile });
            css = result.status === "built" ? readFileSync(stylesFile) : undefined;
        } catch (error) {
            return { ok: false, problem: errorProblem("build", `the CSS step failed: ${error instanceof Error ? error.message : String(error)}`, "Fix the @import lines of the CSS entry, then rerun.") };
        }
    }
    const mainFile = path.join(outDir, "main.js");
    try {
        await esbuildBuild({ ...toEsbuildOptions({ ...build, outfile: mainFile }, cwd, { kind: "release" }), ...(options.preserveSymlinks === true && { preserveSymlinks: true }) });
    } catch (error) {
        if (!isBuildFailure(error)) {
            throw error;
        }
        const details = (await formatMessages(error.errors, { kind: "error", color: false, terminalWidth: 100 })).flatMap((text) => text.trimEnd().split("\n"));
        return { ok: false, problem: errorProblem("build", `the production build failed with ${String(error.errors.length)} error(s).`, "Fix them; `opdk build` prints the same messages.", details) };
    }
    return { ok: true, built: { mainJs: readFileSync(mainFile), css } };
}

/** The groups of a release check that need a build: `build`, `assets` and, when asked, `reproducible`. */
export async function checkBuild(input: BuildCheckInput): Promise<GroupResult[]> {
    const { cwd, build } = input;
    const dirs: string[] = [];
    const tempDir = (): string => {
        // The real path: on macOS the temp folder is reached through a symlink (/var -> /private/var), and esbuild
        // then writes `../..` paths for files it finds through the other spelling.
        const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "opdk-release-"));
        dirs.push(dir);
        // Ctrl+C removes the folder from the signal listener; the finally below covers every other way out.
        input.cleanups.add(() => {
            rmSync(dir, { recursive: true, force: true });
        });
        return dir;
    };
    try {
        const first = await buildOnce(cwd, build, tempDir());
        if (!first.ok) {
            return [{ group: "build", passed: "", problems: [first.problem, ...input.buildNotes] }];
        }
        const results: GroupResult[] = [buildResult(input, first.built), assetsResult(input, first.built)];
        if (input.reproducible) {
            results.push(await reproducibleResult(input, first.built, tempDir));
        }
        return results;
    } finally {
        for (const dir of dirs) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
}

function buildResult({ build, desktopOnly, buildNotes }: BuildCheckInput, built: Built): GroupResult {
    const problems: Problem[] = [...buildNotes];
    const size = formatKib(built.mainJs.length);
    if (!desktopOnly) {
        const references = findNodeOnlyReferences(built.mainJs.toString("utf8"));
        if (references.length > 0) {
            problems.push(errorProblem("build", `${build.outfile} cannot run on mobile.`, "Check the esbuild platform: an Obsidian plugin bundles as `browser`. Set isDesktopOnly in manifest.json only if the plugin needs Node.", references.map((reference) => `- ${reference}`)));
        }
    }
    return { group: "build", passed: `production build of ${build.entry}: ${build.outfile} ${size}${desktopOnly ? "" : ", free of Node-only references"}`, problems };
}

function assetsResult({ cwd, manifestText, build }: BuildCheckInput, built: Built): GroupResult {
    const outputDir = path.dirname(path.resolve(cwd, build.outfile));
    const outputManifestText = outputDir === path.resolve(cwd) ? undefined : loadText(path.join(outputDir, "manifest.json"));
    const stylesAtRoot = path.resolve(cwd, build.css === false ? "styles.css" : build.css.outfile);
    const problems = checkAssets({
        mainJs: built.mainJs,
        builtCss: built.css,
        rootCss: readBytes(stylesAtRoot),
        manifestText,
        outputManifestText,
        outfile: build.outfile,
    });
    const styles = built.css !== undefined ? ", styles.css (built)" : readBytes(stylesAtRoot) !== undefined ? ", styles.css (as committed)" : "";
    return { group: "assets", passed: `main.js, manifest.json${styles}`, problems };
}

const NOT_IN_COMMIT_HINT = "An input of the build is not in the commit: a file that is untracked, ignored by .gitignore or excluded by export-ignore. Commit it, or fix the import, then rerun.";
const DEPENDENCY_LAYOUT_HINT =
    "A package could not be resolved in the copy of the committed tree. That points at the dependency layout (node_modules is linked package by package, so a hoisted or linked layout may not resolve), not at a file missing from the commit. Check `opdk build` resolves it in the plugin folder, or skip the check with --no-reproducible.";

/** The hint for a committed-tree build that failed: a missing file for a relative import, the dependency layout for a package. */
export function committedBuildHint(message: string, details: readonly string[] | undefined): string {
    const text = [message, ...(details ?? [])].join("\n");
    const specifiers = [...text.matchAll(/Could not resolve "([^"]+)"/g)].map((match) => match[1] ?? "");
    const bare = specifiers.some((specifier) => !specifier.startsWith(".") && !specifier.startsWith("/"));
    return bare || text.includes("node_modules/") ? DEPENDENCY_LAYOUT_HINT : NOT_IN_COMMIT_HINT;
}

/**
 * The second build is made from the committed tree (`git archive HEAD`) extracted to another folder, and compared
 * with the working-tree build. That catches inputs git does not hold and absolute paths in the output. Without a
 * repository or a commit it builds the working tree again and says that this proves much less.
 */
async function reproducibleResult(input: BuildCheckInput, first: Built, tempDir: () => string): Promise<GroupResult> {
    const workDir = tempDir();
    let tree: CommittedTree;
    try {
        tree = input.committed === undefined ? { kind: "unavailable", reason: "the folder is not inside a git repository" } : await input.committed(workDir);
    } catch (error) {
        return {
            group: "reproducible",
            passed: "",
            problems: [errorProblem("reproducible", `the committed tree could not be extracted for the second build: ${error instanceof Error ? error.message : String(error)}`, "Fix the problem above (git and tar must work), or skip the check with --no-reproducible.")],
        };
    }
    const outDir = path.join(workDir, "out");
    mkdirSync(outDir);
    const problems: Problem[] = [];
    let comparison: string;
    let causes: string;
    let second: BuildOutcome;
    if (tree.kind === "ready") {
        comparison = `the working-tree build and a build of the committed tree (HEAD ${tree.commit}) extracted to another folder`;
        causes = LIKELY_CAUSES;
        // The packages of node_modules are symlinks there: keep the paths as written so the real folder does not leak into the output.
        second = await buildOnce(tree.dir, input.build, outDir, { preserveSymlinks: true });
        if (!second.ok) {
            return {
                group: "reproducible",
                passed: "",
                problems: [
                    errorProblem(
                        "reproducible",
                        `the committed tree (HEAD ${tree.commit}) does not build, although the working tree does: ${second.problem.message}`,
                        committedBuildHint(second.problem.message, second.problem.details),
                        second.problem.details,
                    ),
                ],
            };
        }
    } else {
        comparison = "two builds of the working tree";
        causes = LIKELY_CAUSES_SAME_TREE;
        problems.push(
            warningProblem(
                "reproducible",
                `${tree.reason.includes("compared two builds") ? tree.reason : `${tree.reason}, so the committed tree could not be compared: two builds of the working tree were`}. That cannot see files git does not hold or absolute paths.`,
                tree.hint ?? "Run the check in a git repository with at least one commit.",
            ),
        );
        second = await buildOnce(input.cwd, input.build, outDir);
        if (!second.ok) {
            return { group: "reproducible", passed: "", problems: [...problems, { ...second.problem, group: "reproducible" }] };
        }
    }
    const pairs: [string, Uint8Array, Uint8Array][] = [["main.js", first.mainJs, second.built.mainJs]];
    if (first.css !== undefined && second.built.css !== undefined) {
        pairs.push(["styles.css", first.css, second.built.css]);
    }
    const dirty = tree.kind === "ready" ? tree.uncommitted : [];
    for (const [file, a, b] of pairs) {
        const difference = firstDifference(a, b);
        if (difference !== undefined) {
            const shown = dirty.slice(0, 3).map((line) => line.trim()).join(", ");
            const uncommitted = dirty.length > 0 ? ` The working tree has ${String(dirty.length)} uncommitted change(s) (${shown}${dirty.length > 3 ? ", ..." : ""}): commit them first to rule them out.` : "";
            problems.push(errorProblem("reproducible", describeDifference(file, comparison, a, b, difference), `${causes}${uncommitted}`));
        }
    }
    const note = dirty.length > 0 ? `; ${String(dirty.length)} uncommitted change(s) are not in the committed tree` : "";
    return { group: "reproducible", passed: `${pairs.map(([file]) => file).join(", ")} identical byte for byte between ${comparison}${note}`, problems };
}
