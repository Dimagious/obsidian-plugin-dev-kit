import { describe, expect, it } from "vitest";
import { callsKitWorkflow, describeRun, KIT_WORKFLOW_PATH, parseRun, parseRuns, pickRun, runOutcome, runPath, runsPath, type WorkflowRun } from "./workflow-run.js";

const KIT = `${KIT_WORKFLOW_PATH}@${"a".repeat(40)}`;
const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({ id: 1, status: "completed", conclusion: "success", event: "push", headSha: "abc", url: "https://example.com/1", name: "Release", createdAt: "2026-11-11T10:00:00Z", referenced: [KIT], ...overrides });

describe("parseRuns", () => {
    it("reads the fields of the REST API", () => {
        const json = JSON.stringify({
            total_count: 1,
            workflow_runs: [{ id: 7, status: "queued", conclusion: null, event: "push", head_sha: "abc", html_url: "u", name: "Release", created_at: "t", referenced_workflows: [{ path: KIT, sha: "s", ref: "r" }, { path: 5 }, "junk"] }],
        });
        expect(parseRuns(json)).toEqual([{ id: 7, status: "queued", conclusion: "", event: "push", headSha: "abc", url: "u", name: "Release", createdAt: "t", referenced: [KIT] }]);
    });

    it("rejects a payload without a list or with a run without an id", () => {
        expect(() => parseRuns("{}")).toThrow("did not return a workflow_runs list");
        expect(() => parseRuns("[]")).toThrow("did not return a workflow_runs list");
        expect(() => parseRuns('{"workflow_runs":[{}]}')).toThrow("without an id");
        expect(() => parseRuns("not json")).toThrow();
    });

    it("tolerates missing optional fields", () => {
        expect(parseRun({ id: 3 })).toMatchObject({ id: 3, status: "", conclusion: "", url: "", referenced: [] });
    });
});

describe("paths", () => {
    it("filters by commit and event, and addresses one run by id", () => {
        expect(runsPath("o/r", "abc")).toBe("repos/o/r/actions/runs?head_sha=abc&event=push&per_page=100");
        expect(runPath("o/r", 42)).toBe("repos/o/r/actions/runs/42");
    });
});

describe("pickRun", () => {
    it("takes the newest push run on exactly the tagged commit that calls the kit's workflow", () => {
        const runs = [
            run({ id: 1, createdAt: "2026-11-11T10:00:00Z" }),
            run({ id: 2, createdAt: "2026-11-11T11:00:00Z" }),
            run({ id: 3, headSha: "other", createdAt: "2026-11-12T00:00:00Z" }),
            run({ id: 4, event: "workflow_dispatch", createdAt: "2026-11-13T00:00:00Z" }),
        ];
        expect(pickRun(runs, "abc")?.id).toBe(2);
    });

    it("ignores a newer run of another workflow on the same commit, such as Pages", () => {
        const pages = run({ id: 9, name: "Pages", referenced: [], createdAt: "2026-11-11T12:00:00Z" });
        expect(pickRun([run({ id: 5 }), pages], "abc")?.id).toBe(5);
        expect(pickRun([pages], "abc")).toBeUndefined();
    });

    it("breaks a tie by id and returns undefined when nothing matches", () => {
        expect(pickRun([run({ id: 1 }), run({ id: 5 })], "abc")?.id).toBe(5);
        expect(pickRun([run({ headSha: "x" })], "abc")).toBeUndefined();
        expect(pickRun([], "abc")).toBeUndefined();
    });
});

describe("callsKitWorkflow", () => {
    it("matches the kit's release.yml at any ref and nothing that merely resembles it", () => {
        expect(callsKitWorkflow(run({ referenced: [`${KIT_WORKFLOW_PATH}@refs/tags/v1.0.0`] }))).toBe(true);
        expect(callsKitWorkflow(run({ referenced: ["other/repo/.github/workflows/x.yml@abc", KIT] }))).toBe(true);
        for (const path of [`${KIT_WORKFLOW_PATH}-copy@abc`, "Someone/obsidian-plugin-dev-kit/.github/workflows/release.yml@abc", ".github/workflows/release.yml", KIT_WORKFLOW_PATH]) {
            expect(callsKitWorkflow(run({ referenced: [path] }))).toBe(false);
        }
        expect(callsKitWorkflow(run({ referenced: [] }))).toBe(false);
    });
});

describe("runOutcome", () => {
    it("waits until completed, succeeds only on success", () => {
        expect(runOutcome(run({ status: "in_progress", conclusion: "" }))).toBe("waiting");
        expect(runOutcome(run({ status: "queued", conclusion: "" }))).toBe("waiting");
        expect(runOutcome(run())).toBe("success");
        for (const conclusion of ["failure", "cancelled", "timed_out", "skipped", "neutral", ""]) {
            expect(runOutcome(run({ conclusion }))).toBe("failed");
        }
    });

    it("describes a run", () => {
        expect(describeRun(run({ status: "in_progress", conclusion: "" }))).toBe("Release run 1: in_progress");
        expect(describeRun(run({ name: "" }))).toBe("workflow run 1: completed (success)");
    });
});
