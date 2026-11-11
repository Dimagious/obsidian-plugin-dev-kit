import { asRecord } from "./json.js";

/** The fields of a GitHub Actions run (REST `GET /repos/{repo}/actions/runs`) that the release waits on. */
export interface WorkflowRun {
    readonly id: number;
    /** `queued`, `in_progress`, `completed`, ... */
    readonly status: string;
    /** Empty until the run is completed; then `success`, `failure`, `cancelled`, ... */
    readonly conclusion: string;
    readonly event: string;
    readonly headSha: string;
    /** For a tag push, the tag name: two tags on one commit share `head_sha` but not this. */
    readonly headBranch: string;
    readonly url: string;
    readonly name: string;
    readonly createdAt: string;
    /** `referenced_workflows[].path`: the reusable workflows the run called, as `owner/repo/.github/workflows/file.yml@ref`. */
    readonly referenced: readonly string[];
}

/**
 * The kit's reusable workflow, which the plugin's tag workflow must call. A run of another workflow on the same tag
 * (all three plugins also publish GitHub Pages on a tag push) is not the release run.
 */
export const KIT_WORKFLOW_PATH = "Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml";

const text = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    return typeof value === "string" ? value : "";
};

/** One run from the REST API. Throws a message that names the problem when the shape is wrong. */
export function parseRun(value: unknown): WorkflowRun {
    const record = asRecord(value);
    const id = record?.id;
    if (record === undefined || typeof id !== "number") {
        throw new Error(`GitHub returned a workflow run without an id: ${JSON.stringify(value)}`);
    }
    const referenced = Array.isArray(record.referenced_workflows)
        ? record.referenced_workflows.flatMap((entry: unknown) => {
              const path = asRecord(entry)?.path;
              return typeof path === "string" ? [path] : [];
          })
        : [];
    return {
        id,
        status: text(record, "status"),
        conclusion: text(record, "conclusion"),
        event: text(record, "event"),
        headSha: text(record, "head_sha"),
        headBranch: text(record, "head_branch"),
        url: text(record, "html_url"),
        name: text(record, "name"),
        createdAt: text(record, "created_at"),
        referenced,
    };
}

/** The runs from the JSON of `GET /actions/runs`. */
export function parseRuns(json: string): WorkflowRun[] {
    const parsed: unknown = JSON.parse(json);
    const runs = asRecord(parsed)?.workflow_runs;
    if (!Array.isArray(runs)) {
        throw new Error("GitHub did not return a workflow_runs list.");
    }
    return runs.map((entry: unknown) => parseRun(entry));
}

/** The REST path that lists the push runs on one commit. */
export const runsPath = (repo: string, commit: string): string => `repos/${repo}/actions/runs?head_sha=${commit}&event=push&per_page=100`;

/** The REST path of one run. */
export const runPath = (repo: string, id: number): string => `repos/${repo}/actions/runs/${String(id)}`;

/** True when the run called the kit's release workflow (at any ref). */
export const callsKitWorkflow = (run: WorkflowRun): boolean => run.referenced.some((path) => path.startsWith(`${KIT_WORKFLOW_PATH}@`));

/**
 * The run that belongs to the tag: a push run on exactly the tagged commit, for exactly this tag (`head_branch` is the
 * tag name on a tag push; two tags on one commit share the commit and its runs), that called the kit's release
 * workflow, the newest if it ran more than once. Other workflows on the same push (Pages, say) are not the release,
 * and a manual re-run by someone else is not a push event.
 */
export function pickRun(runs: readonly WorkflowRun[], commit: string, version: string): WorkflowRun | undefined {
    return runs
        .filter((run) => run.event === "push" && run.headSha === commit && run.headBranch === version && callsKitWorkflow(run))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)[0];
}

export type RunOutcome = "waiting" | "success" | "failed";

/** `completed` with `success` is the only success; `completed` with anything else (cancelled, skipped, timed out) failed. */
export function runOutcome(run: WorkflowRun): RunOutcome {
    if (run.status !== "completed") {
        return "waiting";
    }
    return run.conclusion === "success" ? "success" : "failed";
}

/** A one-line description for the progress output. */
export const describeRun = (run: WorkflowRun): string =>
    `${run.name === "" ? "workflow" : run.name} run ${String(run.id)}: ${run.status}${run.conclusion === "" ? "" : ` (${run.conclusion})`}`;
