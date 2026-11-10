// Writes dist/build-info.json with the short git commit the kit was built from, so `opdk --version` can tell two
// builds of the same package.json version apart (a plugin that pins a commit prints 0.0.0 otherwise).
// Runs at the end of `npm run build`, which `prepare` calls for a git install and a local clone.
// Two sources, in order:
//   1. git, in a checkout of the kit (a local clone, or a clone npm makes for a git install). `-dirty` is added
//      when the working tree has uncommitted changes.
//   2. scripts/archive-commit, for a GitHub install: npm downloads a `git archive` tarball without `.git`.
//      `.gitattributes` has `export-subst` on that file, so git replaces `$Format:%h$` in it with the commit
//      when it makes the archive. In a checkout the file keeps the placeholder, which is not a hash and is ignored.
// Never fails the build: with neither source, the commit is left out and the version stays plain.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A hook or worktree session may export GIT_*; they would point git at another repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

function git(...args) {
    return execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitCommit() {
    try {
        // Without its own .git the kit may still sit inside another repository (a copy under a plugin's
        // node_modules): that repository's commit says nothing about the kit. realpath resolves symlinks and
        // path.relative ignores the case of a Windows drive letter, which plain string equality does not.
        if (path.relative(realpathSync.native(git("rev-parse", "--show-toplevel")), realpathSync.native(root)) !== "") {
            return undefined;
        }
        const sha = git("rev-parse", "--short", "HEAD");
        if (sha === "") {
            return undefined;
        }
        return git("status", "--porcelain") === "" ? sha : `${sha}-dirty`;
    } catch {
        // No git on PATH, not a repository, or no commit yet.
        return undefined;
    }
}

function archiveCommit() {
    try {
        const text = readFileSync(path.join(root, "scripts", "archive-commit"), "utf8").trim();
        return /^[0-9a-f]{7,64}$/.test(text) ? text : undefined;
    } catch {
        // The file is missing from the tree.
        return undefined;
    }
}

const commit = gitCommit() ?? archiveCommit();
mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(path.join(root, "dist", "build-info.json"), `${JSON.stringify(commit === undefined ? {} : { commit })}\n`);
console.log(commit === undefined ? "build-info: no git commit, version stays plain" : `build-info: commit ${commit}`);
