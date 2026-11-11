import type { Reporter } from "../cli/reporter.js";
import type { RunGh } from "./gh.js";
import { StepFailure } from "./publish-state.js";
import { slugText, type RepoSlug } from "./remote.js";
import { describeRun, KIT_WORKFLOW_PATH, parseRun, parseRuns, pickRun, runOutcome, runPath, runsPath, type WorkflowRun } from "./workflow-run.js";

/** Time, injected so a test does not wait. */
export interface Clock {
    now(): number;
    sleep(ms: number): Promise<void>;
}

export interface WaitInput {
    readonly gh: RunGh;
    readonly slug: RepoSlug;
    readonly version: string;
    /** The commit the tag points at; only a run on it counts. */
    readonly commit: string;
    readonly reporter: Reporter;
    readonly clock: Clock;
    /** How long to wait for the workflow to finish once it started. */
    readonly timeoutMs: number;
    /** How long to wait for the run to show up after the tag was pushed. */
    readonly appearMs: number;
    readonly pollMs: number;
}

const HEARTBEAT_MS = 60_000;
const minutes = (ms: number): string => `${String(Math.max(1, Math.round(ms / 60_000)))} min`;

/** Waits for the run that the tag push started: first for it to appear, then for it to finish. Throws a `StepFailure` that names the run URL. */
export async function waitForWorkflow(input: WaitInput): Promise<WorkflowRun> {
    const { gh, slug, version, commit, reporter, clock } = input;
    const repo = slugText(slug);
    const resume = `After fixing the cause, release a new patch version, or re-run the failed jobs on GitHub and then run \`opdk release publish ${version}\`. If the failed run left a draft release behind, delete that draft first: a re-run creates the release again and stops when it exists. The tag ${version} stays on origin.`;
    const startedAt = clock.now();
    let run: WorkflowRun | undefined;
    while (run === undefined) {
        const listed = parseRuns(await gh.text(["api", runsPath(repo, commit)]));
        run = pickRun(listed, commit);
        if (run !== undefined) {
            break;
        }
        if (clock.now() - startedAt >= input.appearMs) {
            const others = [...new Set(listed.filter((other) => other.event === "push" && other.headSha === commit).map((other) => other.name))];
            const seen = others.length === 0 ? "" : ` The runs on this commit are ${others.map((name) => `"${name}"`).join(", ")}, and none of them calls the kit's release workflow.`;
            throw new StepFailure(
                `no release workflow run started for the tag ${version} within ${minutes(input.appearMs)}.${seen}`,
                `The plugin's workflow that runs on \`push: tags\` must call the kit's workflow: \`uses: ${KIT_WORKFLOW_PATH}@<full commit SHA of the kit>\` (copying it does not work, the attestations are checked against the kit's file). Actions must be enabled too (https://github.com/${repo}/actions). Then run \`opdk release publish ${version}\` again: the tag is already on origin and is not pushed twice.`,
            );
        }
        await clock.sleep(input.pollMs);
    }
    reporter.info("wait", `${describeRun(run)} ${run.url}`);
    let last = `${run.status}/${run.conclusion}`;
    let lastBeat = clock.now();
    const watchStart = clock.now();
    for (;;) {
        const outcome = runOutcome(run);
        if (outcome === "success") {
            const waited = clock.now() - watchStart;
            reporter.success("wait", `${run.name === "" ? "workflow" : run.name} succeeded${waited < 1_000 ? "" : ` in ${minutes(waited)}`}`);
            return run;
        }
        if (outcome === "failed") {
            throw new StepFailure(`the release workflow ended with "${run.conclusion}": ${run.url}`, resume);
        }
        if (clock.now() - watchStart >= input.timeoutMs) {
            throw new StepFailure(`the release workflow did not finish within ${minutes(input.timeoutMs)}: ${run.url}`, `It may still be running. When it is done, run \`opdk release publish ${version}\` (use --timeout <minutes> to wait longer).`);
        }
        await clock.sleep(input.pollMs);
        run = parseRun(JSON.parse(await gh.text(["api", runPath(repo, run.id)])));
        const state = `${run.status}/${run.conclusion}`;
        if (state !== last) {
            reporter.info("wait", describeRun(run));
            last = state;
            lastBeat = clock.now();
        } else if (clock.now() - lastBeat >= HEARTBEAT_MS) {
            reporter.info("wait", `still ${run.status} after ${minutes(clock.now() - watchStart)}`);
            lastBeat = clock.now();
        }
    }
}
