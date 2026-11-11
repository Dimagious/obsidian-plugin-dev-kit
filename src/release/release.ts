import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { OpdkConfig } from "../config/types.js";
import { formatDate, planBump, type PlannedFile } from "./bump.js";
import { runReleaseCheck, type CheckFlags } from "./check.js";
import { collectFacts, type RunGit } from "./git.js";
import { CleanupSet, guardInterrupt, INTERRUPTED_EXIT, type InterruptHooks } from "./interrupt.js";
import { asRecord } from "./json.js";
import { changelogPreflight, preflightProblems, unpushedWarning, type PreflightProblem } from "./preflight.js";
import { DEFAULT_CHANGELOG, loadProjectFiles, valueOf, type ProjectFiles } from "./project-files.js";
import { compareVersions } from "./semver.js";
import { resolveVersion, type VersionSpec } from "./args.js";
import { checkVersionSync } from "./version-rules.js";

export interface ReleaseInput {
    readonly cwd: string;
    readonly spec: VersionSpec;
    readonly dryRun: boolean;
    readonly flags: CheckFlags;
    readonly config: OpdkConfig;
    readonly reporter: Reporter;
    /** Prints plain text such as the diff of a dry run. */
    readonly stdout: (text: string) => void;
    readonly run: RunGit;
    /** Ctrl+C handling: the bumped files are restored and the temp folders removed before the process exits with 130. */
    readonly interrupt?: InterruptHooks;
    /** The clock, injected so the changelog date is fixed in tests. */
    readonly now: () => Date;
}

function fail(reporter: Reporter, step: string, problems: readonly PreflightProblem[]): number {
    for (const problem of problems) {
        reporter.failure(step, problem.message, { hint: problem.hint });
    }
    return 1;
}

/** Problems with the files before anything is changed: all versions agree, the new one is higher and not mapped yet. */
function filesProblems(files: ProjectFiles, current: string, next: string): PreflightProblem[] {
    const problems: PreflightProblem[] = [];
    const minAppVersion = asRecord(valueOf(files.manifest))?.minAppVersion;
    if (typeof minAppVersion !== "string") {
        problems.push({ message: "manifest.json has no minAppVersion to map the new version to in versions.json.", hint: 'Add "minAppVersion" to manifest.json.' });
    }
    if ((compareVersions(next, current) ?? 0) <= 0) {
        problems.push({ message: `${next} is not higher than the current version ${current}.`, hint: "Pick a higher version, or use patch, minor or major." });
    }
    const mapped = asRecord(valueOf(files.versions));
    if (mapped !== undefined && Object.hasOwn(mapped, next) && mapped[next] !== minAppVersion) {
        problems.push({ message: `versions.json already maps ${next} to ${String(mapped[next])}, but manifest.json minAppVersion is ${String(minAppVersion)}.`, hint: "An existing entry is never rewritten. Pick another version, or fix the manifest." });
    }
    return problems;
}

/** Writes the planned files and returns what restores them. */
function apply(cwd: string, plan: readonly PlannedFile[]): () => void {
    for (const file of plan) {
        const target = path.join(cwd, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.after);
    }
    return () => {
        for (const file of plan) {
            const target = path.join(cwd, file.path);
            if (file.before === undefined) {
                rmSync(target, { force: true });
            } else {
                writeFileSync(target, file.before);
            }
        }
    };
}

/** The diff of a plan as plain text, without touching git: a new file is shown whole. */
async function renderDiff(run: RunGit, plan: readonly PlannedFile[]): Promise<string> {
    const existing = plan.filter((file) => file.before !== undefined).map((file) => file.path);
    // --no-optional-locks: even `git diff` may refresh the index; a dry run writes nothing to git.
    const tracked = existing.length === 0 ? "" : await run(["--no-optional-locks", "diff", "--no-color", "--", ...existing]);
    const created = plan.filter((file) => file.before === undefined).map((file) => `new file ${file.path}\n${file.after.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n`);
    return [tracked, ...created].join("");
}

/**
 * `opdk release <patch|minor|major|X.Y.Z>`, the local part: preflight, bump the version everywhere, move the
 * changelog entries, run the release check on the result, then commit `chore(release): X.Y.Z` and create the
 * annotated tag `X.Y.Z`. Nothing is pushed. With `dryRun` the files are restored and nothing reaches git.
 */
export async function runRelease(input: ReleaseInput): Promise<number> {
    const { cwd, spec, dryRun, flags, config, reporter, run } = input;
    const changelogFile = config.release?.changelog ?? DEFAULT_CHANGELOG;
    const files = loadProjectFiles(cwd, changelogFile);
    const manifest = asRecord(valueOf(files.manifest));
    const current = manifest?.version;
    if (manifest === undefined || typeof current !== "string") {
        return fail(reporter, "bump", [{ message: "manifest.json is missing, not valid or has no version.", hint: "Run opdk from the plugin root." }]);
    }
    const id = typeof manifest.id === "string" ? manifest.id : "plugin";
    const sync = checkVersionSync({ manifest: valueOf(files.manifest), packageJson: valueOf(files.packageJson), lock: valueOf(files.lock) }).filter((problem) => problem.severity === "error");
    if (sync.length > 0) {
        reporter.failure("bump", `${id}: the versions disagree before the bump, so there is no version to start from.`, { details: sync.map((problem) => problem.message), hint: "Make manifest.json, package.json and package-lock.json equal, commit, and rerun." });
        return 1;
    }
    const version = resolveVersion(spec, current);

    const facts = await collectFacts({ run, version, defaultBranchOverride: config.release?.defaultBranch });
    const gitProblems = preflightProblems(facts, version);
    if (gitProblems.length > 0) {
        return fail(reporter, "git", gitProblems);
    }
    const fileIssues = [...filesProblems(files, current, version), ...changelogPreflight(files.changelog, changelogFile)];
    if (fileIssues.length > 0) {
        return fail(reporter, "bump", fileIssues);
    }
    const unpushed = unpushedWarning(facts);
    if (unpushed !== undefined) {
        reporter.warn("git", unpushed);
    }
    reporter.info("bump", `${id}: ${current} -> ${version}${dryRun ? " (dry run)" : ""}`);

    const plan = planBump({ files, changelogFile, version, date: formatDate(input.now()) });
    const restore = apply(cwd, plan);
    // From here until the commit, Ctrl+C must put the five files back and remove the build folders of the check.
    const cleanups = new CleanupSet();
    const unregisterRestore = cleanups.add(restore);
    const guard = guardInterrupt(input.interrupt, cleanups, reporter);
    let keep = false;
    try {
        for (const file of plan) {
            reporter.success("bump", file.before === undefined ? `${file.path} created` : `${file.path} updated`);
        }
        const overlay = plan.map((file) => ({ path: file.path, content: file.after }));
        const code = await runReleaseCheck({ cwd, config, tag: undefined, flags, reporter, cleanups, run, overlay });
        if (guard.interrupted()) {
            return INTERRUPTED_EXIT;
        }
        if (code !== 0) {
            reporter.failure("bump", `${id}: the release check failed on the bumped files. Nothing was committed and the files are restored.`, { hint: "Fix the problems above and rerun." });
            return 1;
        }
        if (dryRun) {
            input.stdout(`\n${await renderDiff(run, plan)}\n`);
            reporter.info("bump", `dry run: nothing was written, the files are restored. Without --dry-run opdk commits "chore(release): ${version}" and tags ${version}.`);
            return 0;
        }
        keep = true;
        unregisterRestore();
        guard.stop();
        // The files are committed from here on: Ctrl+C cannot restore them any more, so it says how to finish.
        const unregisterCommitWindow = input.interrupt?.onInterrupt(() => {
            reporter.failure("release", `interrupted while committing: finish the commit and the tag by hand (git commit, git tag -a ${version} -m ${version}), or restore with git`);
            input.interrupt?.exit(INTERRUPTED_EXIT);
        });
        try {
            await run(["add", "--", ...plan.map((file) => file.path)]);
            await run(["commit", "--quiet", "-m", `chore(release): ${version}`]);
            await run(["tag", "-a", version, "-m", version]);
            unregisterCommitWindow?.();
        } catch (error) {
            unregisterCommitWindow?.();
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}\nThe bumped files stay in the working tree (staged if \`git add\` ran). Look at \`git status\`: finish the commit and the tag ${version} by hand, or restore the files with git.`,
                { cause: error },
            );
        }
    } finally {
        guard.stop();
        if (!keep) {
            restore();
        }
    }
    reporter.success("git", `committed "chore(release): ${version}" and created the annotated tag ${version}`);
    const branch = facts.defaultBranch ?? "<default branch>";
    reporter.info(
        "git",
        `nothing was pushed: the push flow is not built yet (phase 2). Push the tag first with \`git push origin ${version}\`, check the release it creates, then push the branch with \`git push origin ${branch}\`.`,
    );
    return 0;
}
