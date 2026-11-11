import { describe, expect, it } from "vitest";
import { describeRun, parseRun, parseRuns, pickRun, runOutcome, type WorkflowRun } from "./workflow-run.js";

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({ id: 1, status: "completed", conclusion: "success", event: "push", headSha: "abc", url: "https://example.com/1", name: "Release", createdAt: "2026-11-11T10:00:00Z", ...overrides });

describe("parseRuns", () => {
    it("reads the fields gh prints", () => {
        const json = JSON.stringify([{ databaseId: 7, status: "queued", conclusion: "", event: "push", headSha: "abc", url: "u", workflowName: "Release", createdAt: "t" }]);
        expect(parseRuns(json)).toEqual([{ id: 7, status: "queued", conclusion: "", event: "push", headSha: "abc", url: "u", name: "Release", createdAt: "t" }]);
    });

    it("rejects a payload that is not a list or has a run without an id", () => {
        expect(() => parseRuns("{}")).toThrow("did not return a JSON array");
        expect(() => parseRuns("[{}]")).toThrow("without a databaseId");
        expect(() => parseRuns("not json")).toThrow();
    });

    it("tolerates missing optional fields", () => {
        expect(parseRun({ databaseId: 3 })).toMatchObject({ id: 3, status: "", conclusion: "", url: "" });
    });
});

describe("pickRun", () => {
    it("takes the newest push run on exactly the tagged commit", () => {
        const runs = [run({ id: 1, createdAt: "2026-11-11T10:00:00Z" }), run({ id: 2, createdAt: "2026-11-11T11:00:00Z" }), run({ id: 3, headSha: "other", createdAt: "2026-11-12T00:00:00Z" }), run({ id: 4, event: "workflow_dispatch", createdAt: "2026-11-13T00:00:00Z" })];
        expect(pickRun(runs, "abc")?.id).toBe(2);
    });

    it("breaks a tie by id and returns undefined when nothing matches", () => {
        expect(pickRun([run({ id: 1 }), run({ id: 5 })], "abc")?.id).toBe(5);
        expect(pickRun([run({ headSha: "x" })], "abc")).toBeUndefined();
        expect(pickRun([], "abc")).toBeUndefined();
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
