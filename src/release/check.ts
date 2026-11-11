import type { Reporter } from "../cli/reporter.js";
import { resolveBuild } from "../build/options.js";
import type { OpdkConfig } from "../config/types.js";
import { checkChangelog } from "./changelog.js";
import { checkBuildScript } from "./build-script.js";
import { extractCommittedTree, type OverlayFile } from "./committed-tree.js";
import { createRunGit, type RunGit } from "./git.js";
import { CleanupSet, guardInterrupt, type InterruptHooks } from "./interrupt.js";
import { asRecord } from "./json.js";
import { checkManifestRules } from "./manifest-rules.js";
import { CHECK_GROUPS, errorProblem, hasErrors, type CheckGroup, type GroupResult, type Problem } from "./problems.js";
import { loadProjectFiles, valueOf, type ProjectFiles } from "./project-files.js";
import { checkVersionSync } from "./version-rules.js";
import { checkVersionsJson } from "./versions-json.js";

/** Which of the checks that cost time (a build, a type-aware lint) run. The cheap ones always do. */
export interface CheckFlags {
    /** `--no-build`: skips `build`, `assets` and `reproducible`. */
    readonly build: boolean;
    /** `--no-reproducible`: builds once instead of twice. */
    readonly reproducible: boolean;
    /** `--no-api`: skips the `minAppVersion` against API check. */
    readonly api: boolean;
}

export const ALL_CHECKS: CheckFlags = { build: true, reproducible: true, api: true };

export interface CheckInput {
    readonly cwd: string;
    readonly config: OpdkConfig;
    readonly tag: string | undefined;
    readonly flags: CheckFlags;
    readonly reporter: Reporter;
    /** Ctrl+C handling. Without it (a test) the temp folders of an interrupted check are not removed. */
    readonly interrupt?: InterruptHooks;
    /** Shared with a caller that registers its own Ctrl+C guard (the release); the check then adds to it and registers none. */
    readonly cleanups?: CleanupSet;
    /** Git for the committed tree of the reproducibility check. Defaults to the real thing in `cwd`. */
    readonly run?: RunGit;
    /** Files that the caller changed but has not committed yet; laid over the committed tree so it matches the commit to come. */
    readonly overlay?: readonly OverlayFile[];
}

const SKIPPED: Partial<Record<CheckGroup, (flags: CheckFlags) => string | undefined>> = {
    build: (flags) => (flags.build ? undefined : "--no-build"),
    assets: (flags) => (flags.build ? undefined : "--no-build"),
    reproducible: (flags) => (!flags.build ? "--no-build" : flags.reproducible ? undefined : "--no-reproducible"),
    api: (flags) => (flags.api ? undefined : "--no-api"),
};

function fileProblems(files: ProjectFiles): Problem[] {
    const problems: Problem[] = [];
    const names: [string, ProjectFiles["packageJson"], boolean][] = [
        ["package.json", files.packageJson, true],
        ["package-lock.json", files.lock, false],
    ];
    for (const [name, loaded, required] of names) {
        if (loaded.kind === "invalid") {
            problems.push(errorProblem("versions", `${name} is not valid JSON: ${loaded.message}.`, "Fix the syntax."));
        } else if (loaded.kind === "missing" && required) {
            problems.push(errorProblem("versions", `${name} is missing.`, "Run opdk from the plugin root."));
        }
    }
    return problems;
}

function versionsResult(files: ProjectFiles, version: string, tag: string | undefined): GroupResult {
    const problems = [
        ...fileProblems(files),
        ...checkVersionSync({ manifest: valueOf(files.manifest), packageJson: valueOf(files.packageJson), lock: valueOf(files.lock) }, tag),
    ];
    const places = files.lock.kind === "ok" ? "manifest.json, package.json and package-lock.json" : "manifest.json and package.json";
    return { group: "versions", passed: `${places} are all ${version}${tag === undefined ? "" : `, tag ${tag} matches`}`, problems };
}

/** The groups that need no build, in the order they print. Exported for the bump, which reuses them before it builds. */
export function staticResults(files: ProjectFiles, changelogFile: string, tag: string | undefined): GroupResult[] {
    const manifest = asRecord(valueOf(files.manifest));
    const version = typeof manifest?.version === "string" ? manifest.version : "";
    const minAppVersion = typeof manifest?.minAppVersion === "string" ? manifest.minAppVersion : undefined;
    return [
        versionsResult(files, version, tag),
        { group: "versions.json", passed: `${version} maps to ${minAppVersion ?? "?"}`, problems: checkVersionsJson(files.versions, version, minAppVersion) },
        { group: "manifest", passed: "manifest.json follows the directory's rules", problems: checkManifestRules(manifest) },
        { group: "changelog", passed: `${changelogFile} has a section for ${version}`, problems: checkChangelog(files.changelog, version, changelogFile) },
    ];
}

/** Prints the results in group order. Returns the number of errors. */
export function reportResults(results: readonly GroupResult[], flags: CheckFlags, reporter: Reporter): number {
    let errors = 0;
    for (const group of CHECK_GROUPS) {
        const skipped = SKIPPED[group]?.(flags);
        const result = results.find((candidate) => candidate.group === group);
        if (skipped !== undefined) {
            reporter.info("check", `${group}: skipped (${skipped})`);
        } else if (result !== undefined) {
            errors += reportGroup(result, reporter);
        }
    }
    return errors;
}

function reportGroup(result: GroupResult, reporter: Reporter): number {
    let errors = 0;
    for (const problem of result.problems) {
        const text = `${problem.group}: ${problem.message}`;
        if (problem.severity === "warning") {
            reporter.warn("check", text);
        } else {
            errors++;
            reporter.failure("check", text, { ...(problem.details !== undefined && { details: problem.details }), ...(problem.hint !== undefined && { hint: problem.hint }) });
        }
    }
    if (!hasErrors(result.problems)) {
        reporter.success("check", `${result.group}: ${result.passed}`);
    }
    return errors;
}

/** `opdk release check`: every rule that decides whether this commit can be released. Returns the exit code. */
export async function runReleaseCheck(input: CheckInput): Promise<number> {
    const cleanups = input.cleanups ?? new CleanupSet();
    const guard = input.cleanups === undefined ? guardInterrupt(input.interrupt, cleanups, input.reporter) : undefined;
    try {
        return await checkWith(input, cleanups);
    } finally {
        guard?.stop();
    }
}

async function checkWith({ cwd, config, tag, flags, reporter, run, overlay }: CheckInput, cleanups: CleanupSet): Promise<number> {
    const changelogFile = config.release?.changelog ?? "CHANGELOG.md";
    const files = loadProjectFiles(cwd, changelogFile);
    const manifest = asRecord(valueOf(files.manifest));
    if (files.manifest.kind !== "ok" || manifest === undefined) {
        const why = files.manifest.kind === "invalid" ? `is not valid JSON: ${files.manifest.message}` : files.manifest.kind === "missing" ? `is missing in ${cwd}` : "must contain a JSON object";
        reporter.failure("check", `manifest.json ${why}.`, { hint: "Run opdk from the plugin root." });
        return 1;
    }
    const id = typeof manifest.id === "string" ? manifest.id : "plugin";
    const version = typeof manifest.version === "string" ? manifest.version : "?";
    const minAppVersion = typeof manifest.minAppVersion === "string" ? manifest.minAppVersion : undefined;
    reporter.info("check", `${id} ${version}${tag === undefined ? "" : ` (tag ${tag})`}`);

    const results = staticResults(files, changelogFile, tag);
    if (flags.build) {
        // Loaded here, not at the top, like the scan: the build pulls in esbuild.
        const { checkBuild } = await import("./build-check.js");
        const git = run ?? createRunGit(cwd);
        results.push(
            ...(await checkBuild({
                cwd,
                manifestText: files.manifest.text,
                desktopOnly: manifest.isDesktopOnly === true,
                build: resolveBuild(config.build),
                reproducible: flags.reproducible,
                buildNotes: checkBuildScript(valueOf(files.packageJson)),
                cleanups,
                committed: (workDir) => extractCommittedTree({ cwd, run: git, workDir, overlay: overlay ?? [] }),
            })),
        );
    }
    if (flags.api) {
        const { checkApiUsage } = await import("./api-check.js");
        results.push(await checkApiUsage({ cwd, minAppVersion, build: resolveBuild(config.build) }));
    }
    const errors = reportResults(results, flags, reporter);
    if (errors > 0) {
        reporter.failure("check", `${id} ${version}: ${String(errors)} problem(s), not ready to release.`, { hint: "Fix them and rerun `opdk release check`." });
        return 1;
    }
    reporter.success("check", `${id} ${version}: ready to release.`);
    return 0;
}
