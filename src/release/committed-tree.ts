import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitFreeEnvironment } from "../scanner/git-files.js";
import { tryGit, type RunGit } from "./git.js";

const execFileAsync = promisify(execFile);

/** A file the release is about to commit, laid over the extracted tree so the copy matches the commit-to-be. */
export interface OverlayFile {
    readonly path: string;
    readonly content: string;
}

export type CommittedTree =
    | {
          readonly kind: "ready";
          /** The folder holding the extracted files, at a path other than the plugin folder. */
          readonly dir: string;
          /** Short hash of the commit the copy was made from. */
          readonly commit: string;
          /** `git status --porcelain` lines the copy does not contain (changed or untracked files), minus the overlay. */
          readonly uncommitted: readonly string[];
      }
    | {
          readonly kind: "unavailable";
          readonly reason: string;
          /** What to do about it; the caller has a default for the missing-repository case. */
          readonly hint?: string;
      };

export interface CommittedTreeInput {
    readonly cwd: string;
    readonly run: RunGit;
    /** An empty folder to extract into; its parent holds the tar file. */
    readonly workDir: string;
    readonly overlay: readonly OverlayFile[];
    /** The commit-ish to extract. Default `HEAD`; the publish step passes the release tag. */
    readonly ref?: string;
}

/** The path a porcelain line is about (`XY path`, or `XY old -> new`). */
const porcelainPath = (line: string): string => {
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    return arrow === -1 ? rest : rest.slice(arrow + 4);
};

/** The part of a directory entry the linking decision needs (`fs.Dirent` has it). */
export interface EntryLike {
    readonly name: string;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

/**
 * Whether an entry of `node_modules` gets a link. `.bin` is skipped, and so are plain files such as
 * `.package-lock.json` and `.modules.yaml`: a Windows junction can only point at a folder. A symlink is kept
 * (npm workspaces and `npm link` put them there).
 */
export function isLinkableEntry(entry: EntryLike): boolean {
    return entry.name !== ".bin" && (entry.isDirectory() || entry.isSymbolicLink());
}

/**
 * Names the install layout the committed-tree build cannot work with, or `undefined` for a plain npm layout.
 * pnpm keeps the dependencies of a package next to its real path under `node_modules/.pnpm`, and Yarn PnP has no
 * `node_modules` to link, so a linked copy would not resolve imports the way the real folder does.
 */
export function unsupportedInstallLayout(exists: (relative: string) => boolean): string | undefined {
    if (exists("node_modules/.pnpm") || exists("node_modules/.modules.yaml")) {
        return "pnpm install";
    }
    if (exists(".pnp.cjs") || exists(".pnp.js")) {
        return "Yarn PnP install";
    }
    return undefined;
}

/**
 * Makes the plugin's packages reachable from the copy. The folder itself is not linked: esbuild resolves a linked
 * `node_modules` to its real location and then writes `../../..` paths into the unminified output, which would read
 * as a difference. Each package is linked instead (a scope folder is real, its packages are links) and the build runs
 * with `preserveSymlinks`, so the paths stay `node_modules/<package>/...`. Does nothing when the plugin has no
 * `node_modules` or the commit holds one.
 */
function linkNodeModules(source: string, target: string): void {
    if (!existsSync(source) || existsSync(target)) {
        return;
    }
    mkdirSync(target);
    // A junction needs no admin rights on Windows; the type is ignored elsewhere.
    const link = (from: string, to: string): void => {
        symlinkSync(from, to, "junction");
    };
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (!isLinkableEntry(entry)) {
            continue;
        }
        if (entry.name.startsWith("@") && entry.isDirectory()) {
            mkdirSync(path.join(target, entry.name));
            for (const scoped of readdirSync(path.join(source, entry.name))) {
                link(path.join(source, entry.name, scoped), path.join(target, entry.name, scoped));
            }
        } else {
            link(path.join(source, entry.name), path.join(target, entry.name));
        }
    }
}

/**
 * `git archive HEAD` of the plugin folder, extracted to `workDir/plugin-copy` with the plugin's packages
 * reachable through symlinks. Building there and comparing with the working-tree build catches inputs git does not
 * hold (untracked or ignored files) and absolute paths of this machine in the output. It does not catch a different
 * Node or esbuild version or lockfile drift, because `node_modules` is the one on this machine.
 *
 * `git archive` applies `export-ignore` from `.gitattributes`, which a checkout does not; a build that needs such a
 * file fails in the copy and says so. Git LFS files are pointer text in the archive, so a build input tracked by LFS
 * makes the comparison differ.
 *
 * A pnpm or Yarn PnP install is not extracted (see `unsupportedInstallLayout`): `unavailable` makes the caller
 * compare two builds of the working tree.
 *
 * Throws when git or tar fails inside a repository; returns `unavailable` when there is no repository or commit.
 */
export async function extractCommittedTree({ cwd, run, workDir, overlay, ref = "HEAD" }: CommittedTreeInput): Promise<CommittedTree> {
    if ((await tryGit(run, ["rev-parse", "--is-inside-work-tree"])) !== "true") {
        return { kind: "unavailable", reason: "the folder is not inside a git repository" };
    }
    const commit = await tryGit(run, ["rev-parse", "--short", "--verify", "--quiet", `${ref}^{commit}`]);
    if (commit === undefined || commit === "") {
        return { kind: "unavailable", reason: ref === "HEAD" ? "the repository has no commit yet" : `the repository has no commit ${ref}` };
    }
    const layout = unsupportedInstallLayout((relative) => existsSync(path.join(cwd, relative)));
    if (layout !== undefined) {
        return {
            kind: "unavailable",
            reason: `${layout}: compared two builds of the working tree, not the committed tree (its packages cannot be linked into a copy)`,
            hint: "Use an npm layout (npm ci) to compare the committed tree, or accept the weaker check.",
        };
    }
    const overlaid = new Set(overlay.map((file) => file.path));
    const uncommitted = (await run(["--no-optional-locks", "status", "--porcelain"])).split("\n").filter((line) => line !== "" && !overlaid.has(porcelainPath(line)));

    const tarFile = path.join(workDir, "committed.tar");
    const dir = path.join(workDir, "plugin-copy");
    mkdirSync(dir);
    // Run inside the plugin folder, git archives only that folder, so a plugin in a subfolder of a repository works.
    await run(["archive", "--format=tar", "-o", tarFile, ref]);
    try {
        await execFileAsync("tar", ["-xf", tarFile, "-C", dir], { env: gitFreeEnvironment(process.env) });
    } catch (error) {
        throw new Error(`tar could not extract the committed tree: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    linkNodeModules(path.join(cwd, "node_modules"), path.join(dir, "node_modules"));
    for (const file of overlay) {
        const target = path.join(dir, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.content);
    }
    return { kind: "ready", dir, commit, uncommitted };
}
