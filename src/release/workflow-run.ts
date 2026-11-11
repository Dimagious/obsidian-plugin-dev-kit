import { asRecord } from "./json.js";

/** The fields of a GitHub Actions run that the release waits on. */
export interface WorkflowRun {
    readonly id: number;
    /** `queued`, `in_progress`, `completed`, ... */
    readonly status: string;
    /** Empty until the run is completed; then `success`, `failure`, `cancelled`, ... */
    readonly conclusion: string;
    readonly event: string;
    readonly headSha: string;
    readonly url: string;
    readonly name: string;
    readonly createdAt: string;
}

/** The `--json` fields to ask `gh run list` and `gh run view` for. */
export const RUN_FIELDS = "databaseId,status,conclusion,event,headSha,url,workflowName,createdAt";

function field(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === "string" ? value : "";
}

/** One run from the JSON of `gh run view`. Throws a message that names the problem when the shape is wrong. */
export function parseRun(value: unknown): WorkflowRun {
    const record = asRecord(value);
    const id = record?.databaseId;
    if (record === undefined || typeof id !== "number") {
        throw new Error(`gh returned a workflow run without a databaseId: ${JSON.stringify(value)}`);
    }
    return {
        id,
        status: field(record, "status"),
        conclusion: field(record, "conclusion"),
        event: field(record, "event"),
        headSha: field(record, "headSha"),
        url: field(record, "url"),
        name: field(record, "workflowName"),
        createdAt: field(record, "createdAt"),
    };
}

/** The runs from the JSON of `gh run list`. */
export function parseRuns(json: string): WorkflowRun[] {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) {
        throw new Error("gh run list did not return a JSON array.");
    }
    return parsed.map((entry) => parseRun(entry));
}

/**
 * The run that belongs to the tag: a push run on exactly the tagged commit, the newest if the workflow ran more
 * than once. `gh run list --branch <tag>` already narrows to the tag; the commit and the event rule out a run of an
 * older tag with the same name and a manual re-run triggered by someone else.
 */
export function pickRun(runs: readonly WorkflowRun[], commit: string): WorkflowRun | undefined {
    return runs
        .filter((run) => run.event === "push" && run.headSha === commit)
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
