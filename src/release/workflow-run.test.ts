import { describe, expect, it } from "vitest";
import { callsKitWorkflow, describeRun, KIT_WORKFLOW_PATH, parseRun, parseRuns, pickRun, runOutcome, runPath, runsPath, type WorkflowRun } from "./workflow-run.js";

const KIT = `${KIT_WORKFLOW_PATH}@${"a".repeat(40)}`;
const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({ id: 1, status: "completed", conclusion: "success", event: "push", headSha: "abc", headBranch: "1.0.1", url: "https://example.com/1", name: "Release", createdAt: "2026-11-11T10:00:00Z", referenced: [KIT], ...overrides });

describe("parseRuns", () => {
    it("reads the fields of the REST API", () => {
        const json = JSON.stringify({
            total_count: 1,
            workflow_runs: [{ id: 7, status: "queued", conclusion: null, event: "push", head_sha: "abc", head_branch: "1.0.1", html_url: "u", name: "Release", created_at: "t", referenced_workflows: [{ path: KIT, sha: "s", ref: "r" }, { path: 5 }, "junk"] }],
        });
        expect(parseRuns(json)).toEqual([{ id: 7, status: "queued", conclusion: "", event: "push", headSha: "abc", headBranch: "1.0.1", url: "u", name: "Release", createdAt: "t", referenced: [KIT] }]);
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
        expect(pickRun(runs, "abc", "1.0.1")?.id).toBe(2);
    });

    it("ignores a newer run of another workflow on the same commit, such as Pages", () => {
        const pages = run({ id: 9, name: "Pages", referenced: [], createdAt: "2026-11-11T12:00:00Z" });
        expect(pickRun([run({ id: 5 }), pages], "abc", "1.0.1")?.id).toBe(5);
        expect(pickRun([pages], "abc", "1.0.1")).toBeUndefined();
    });

    it("takes only the run of the asked tag when two tags point at one commit", () => {
        const older = run({ id: 1, headBranch: "1.0.1", createdAt: "2026-11-11T10:00:00Z" });
        const newerOtherTag = run({ id: 2, headBranch: "1.0.2", conclusion: "failure", createdAt: "2026-11-11T11:00:00Z" });
        expect(pickRun([older, newerOtherTag], "abc", "1.0.1")?.id).toBe(1);
        expect(pickRun([older, newerOtherTag], "abc", "1.0.2")?.id).toBe(2);
        expect(pickRun([older], "abc", "1.0.2")).toBeUndefined();
        expect(pickRun([run({ headBranch: "" })], "abc", "1.0.1")).toBeUndefined();
    });

    it("breaks a tie by id and returns undefined when nothing matches", () => {
        expect(pickRun([run({ id: 1 }), run({ id: 5 })], "abc", "1.0.1")?.id).toBe(5);
        expect(pickRun([run({ headSha: "x" })], "abc", "1.0.1")).toBeUndefined();
        expect(pickRun([], "abc", "1.0.1")).toBeUndefined();
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
