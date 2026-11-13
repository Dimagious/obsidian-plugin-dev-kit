import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import { ALL_CHECKS, reportResults } from "../release/check.js";
import { sectionsBetween } from "../release/changelog.js";
import { tryGit, type RunGit } from "../release/git.js";
import { loadJson } from "../release/json.js";
import { checkKit } from "../release/kit-check.js";
import { loadProjectFiles } from "../release/project-files.js";
import { compareVersions } from "../release/semver.js";
import { loadWorkflows } from "./files.js";
import { isFullSha, readLockPin, readPackageJsonPins, rewritePackageJson, rewriteWorkflow, shortSha, stripV, type TextChange } from "./pins.js";
import { kitChangelogUrl, kitRepositoryUrl, latestTag, parseKitTags, sortedTags } from "./remote.js";

/** What the upgrade does to the world. Injected, so a test never touches the network or runs npm. */
export interface UpgradeDeps {
    /** Git in the plugin folder. Also asked for the kit's tags (`ls-remote`). */
    readonly run: RunGit;
    /** `npm <args>` in the plugin folder; rejects with npm's message. */
    readonly npm: (args: readonly string[]) => Promise<void>;
    /** The text behind a URL; rejects when it cannot be read. */
    readonly fetchText: (url: string) => Promise<string>;
}

export interface UpgradeInput {
    readonly cwd: string;
    /** `vX.Y.Z`; undefined asks the kit's repository for the latest release tag. */
    readonly target: string | undefined;
    readonly dryRun: boolean;
    readonly reporter: Reporter;
    readonly stdout: (text: string) => void;
    readonly deps: UpgradeDeps;
}

const STEP = "kit";
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface FileChange {
    readonly file: string;
    readonly text: string;
    readonly changes: readonly TextChange[];
}

/** The changed lines as a diff: file, line number, the old line and the new one. */
function renderChanges(changes: readonly FileChange[]): string {
    return changes
        .flatMap((file) => file.changes.map((change) => `${file.file}:${String(change.line)}\n- ${change.before.trim()}\n+ ${change.after.trim()}\n`))
        .join("\n");
}

function fail(reporter: Reporter, text: string, hint: string, details?: readonly string[]): number {
    reporter.failure(STEP, text, { hint, ...(details !== undefined && { details }) });
    return 1;
}

/**
 * `opdk kit upgrade [vX.Y.Z]`: moves package.json, the lockfile and the kit's workflow pins to one kit release, then
 * runs the `kit` release check on the result. Nothing is committed or pushed. With `dryRun` it prints what would
 * change and writes nothing.
 */
export async function runKitUpgrade(input: UpgradeInput): Promise<number> {
    const { cwd, reporter, deps, dryRun } = input;
    const packagePath = path.join(cwd, "package.json");
    const lockPath = path.join(cwd, "package-lock.json");
    const pkg = loadJson(packagePath);
    if (pkg.kind !== "ok") {
        return fail(reporter, pkg.kind === "missing" ? `package.json is missing in ${cwd}.` : `package.json is not valid JSON: ${pkg.message}.`, "Run opdk from the plugin root.");
    }
    const [spec] = readPackageJsonPins(pkg.value);
    if (spec === undefined) {
        return fail(reporter, "package.json does not depend on obsidian-plugin-dev-kit through GitHub.", "Install it with `npm install --save-dev github:Dimagious/obsidian-plugin-dev-kit#vX.Y.Z`. A kit linked from a folder is not upgraded by opdk.");
    }
    const { owner } = spec.parsed;

    if (!dryRun) {
        const inside = await tryGit(deps.run, ["rev-parse", "--is-inside-work-tree"]);
        if (inside !== "true") {
            return fail(reporter, "this folder is not inside a git repository.", "Run opdk from the plugin repository: the upgrade must be a change you can review and undo with git. --dry-run works anywhere.");
        }
        const dirty = (await deps.run(["status", "--porcelain"])).split("\n").filter((line) => line !== "");
        if (dirty.length > 0) {
            return fail(reporter, `the working tree is not clean (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` and ${String(dirty.length - 5)} more` : ""}).`, "Commit or discard the changes first, so the upgrade is the only change in its commit. --dry-run works on a dirty tree.");
        }
    }

    let tags;
    try {
        tags = parseKitTags(await deps.run(["ls-remote", "--tags", kitRepositoryUrl(owner)]));
    } catch (error) {
        return fail(reporter, `could not list the kit's release tags: ${message(error)}`, "Check the network and rerun.");
    }
    const tag = input.target ?? latestTag(tags);
    if (tag === undefined) {
        return fail(reporter, `${kitRepositoryUrl(owner)} has no vX.Y.Z release tag.`, "Name the tag yourself: `opdk kit upgrade vX.Y.Z`.");
    }
    const sha = tags.get(tag);
    if (sha === undefined) {
        const known = sortedTags(tags).slice(0, 5).join(", ");
        return fail(reporter, `the kit has no release tag ${tag}.`, known === "" ? "Check the spelling." : `The latest tags are: ${known}.`);
    }

    const current = spec.parsed.ref;
    const lock = loadJson(lockPath);
    if (lock.kind === "invalid") {
        return fail(reporter, `package-lock.json is not valid JSON: ${lock.message}.`, "Restore it from git, or delete it and run `npm install`.");
    }
    const lockText = lock.kind === "ok" ? lock.text : undefined;
    const lockPin = lock.kind === "ok" ? readLockPin(lock.value) : undefined;
    const packageChange: FileChange = { file: "package.json", ...rewritePackageJson(pkg.text, tag) };
    const workflowChanges: FileChange[] = loadWorkflows(cwd).map(({ file, text }) => ({ file, ...rewriteWorkflow(text, sha, tag) })).filter((file) => file.changes.length > 0);
    const changed = [packageChange, ...workflowChanges].filter((file) => file.changes.length > 0);
    const lockStale = lockText !== undefined && lockPin?.commit !== sha;

    reporter.info(STEP, `kit ${isFullSha(current) ? shortSha(current) : current} -> ${tag} (${shortSha(sha)})${dryRun ? " (dry run)" : ""}`);
    if (changed.length === 0 && !lockStale) {
        reporter.success(STEP, `package.json, package-lock.json and the workflow pins are already at ${tag} (${shortSha(sha)}); nothing to change.`);
        return 0;
    }
    if (changed.length > 0) {
        input.stdout(`\n${renderChanges(changed)}\n`);
    }
    if (lockStale) {
        const was = lockPin?.commit === undefined ? "no commit" : shortSha(lockPin.commit);
        reporter.info(STEP, `package-lock.json: ${was} -> ${shortSha(sha)}, rewritten by \`npm install\``);
    } else if (lockText === undefined) {
        reporter.warn(STEP, "there is no package-lock.json; run `npm install` yourself to create one.");
    }
    await showKitChanges(input, owner, tag, lockPin?.version ?? (isFullSha(current) ? undefined : stripV(current)));

    if (dryRun) {
        reporter.info(STEP, "dry run: nothing was written. Without --dry-run opdk edits these files and runs `npm install`; it never commits.");
        return 0;
    }

    // Everything that can fail halfway is written first and restored on failure: package.json, then npm's lockfile.
    writeFileSync(packagePath, packageChange.text);
    if (lockStale) {
        reporter.info(STEP, `npm install obsidian-plugin-dev-kit@${tag} (builds the kit, can take a minute)`);
        try {
            await deps.npm(["install", "--no-audit", "--no-fund", `obsidian-plugin-dev-kit@github:${owner}/obsidian-plugin-dev-kit#${tag}`]);
        } catch (error) {
            writeFileSync(packagePath, pkg.text);
            writeFileSync(lockPath, lockText);
            return fail(reporter, `npm install failed, so nothing was changed: ${message(error)}`, `Fix npm, or run \`npm install --save-dev github:${owner}/obsidian-plugin-dev-kit#${tag}\` yourself and then \`opdk kit upgrade ${tag}\` for the workflow pins.`);
        }
    }
    for (const file of workflowChanges) {
        writeFileSync(path.join(cwd, file.file), file.text);
    }
    reporter.success(STEP, `package.json, package-lock.json and ${String(workflowChanges.length)} workflow file(s) now point at ${tag} (${shortSha(sha)})`);

    const errors = reportResults([checkKit(loadProjectFiles(cwd), loadWorkflows(cwd))], ALL_CHECKS, reporter);
    if (errors > 0) {
        return 1;
    }
    reporter.info(STEP, "nothing was committed: review `git diff`, commit on a branch and open a pull request.");
    return 0;
}

/** The kit's CHANGELOG sections between the current version and the new tag, from the tag on GitHub. Never fails the upgrade. */
async function showKitChanges(input: UpgradeInput, owner: string, tag: string, from: string | undefined): Promise<void> {
    const { reporter } = input;
    const url = kitChangelogUrl(owner, tag);
    try {
        const order = from === undefined ? 1 : (compareVersions(stripV(tag), from) ?? 1);
        if (order < 0) {
            reporter.warn(STEP, `${tag} is older than ${from ?? "the current kit"}: this is a downgrade.`);
            return;
        }
        if (order === 0) {
            return;
        }
        const sections = sectionsBetween(await input.deps.fetchText(url), from, stripV(tag));
        if (sections.length === 0) {
            reporter.info(STEP, `the kit CHANGELOG at ${tag} has no section ${from === undefined ? "for it" : `after ${from}`}.`);
            return;
        }
        reporter.info(STEP, `kit changes${from === undefined ? "" : ` since ${from}`}, newest first:`);
        input.stdout(`\n${sections.join("\n\n")}\n\n`);
    } catch (error) {
        reporter.info(STEP, `could not read the kit CHANGELOG (${message(error)}); see ${url}`);
    }
}
