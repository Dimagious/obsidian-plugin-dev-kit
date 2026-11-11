import { describe, expect, it } from "vitest";
import { StepFailure, stopReport, type Stage } from "./publish-state.js";

const report = (stage: Stage, interrupted = false): ReturnType<typeof stopReport> => stopReport(stage, "1.2.3", "main", { interrupted });

describe("stopReport", () => {
    it("always names the resume command", () => {
        for (const stage of ["preflight", "gh", "tag", "release-lookup", "workflow", "verify", "publish", "latest", "branch"] as const) {
            expect(report(stage).resume).toBe("opdk release publish 1.2.3");
        }
    });

    it("says nothing was pushed before the tag", () => {
        expect(report("gh").state).toEqual(["Nothing new was pushed."]);
        expect(report("preflight").where).toBe("stopped while checking the tag and the branch");
    });

    it("warns that a tag push in flight may have arrived", () => {
        expect(report("tag", true).where).toBe("interrupted while pushing the tag");
        expect(report("tag", true).state[0]).toContain("git ls-remote --tags origin 1.2.3");
        expect(report("tag").state[0]).toBe("The tag 1.2.3 was not pushed.");
    });

    it("says the tag is on origin and the release not public while waiting and verifying", () => {
        for (const stage of ["release-lookup", "workflow", "verify"] as const) {
            expect(report(stage).state).toEqual(["The tag 1.2.3 is on origin.", "The release is not public (a draft at most).", "The branch main was not pushed."]);
        }
    });

    it("says the release is public when a stop comes after it became public (a resume after a failed branch push)", () => {
        for (const stage of ["release-lookup", "workflow", "verify", "publish"] as const) {
            const state = stopReport(stage, "1.2.3", "main", { interrupted: true, releasePublic: true }).state;
            expect(state).toEqual(["The tag 1.2.3 is on origin.", "The release 1.2.3 is public.", "The branch main was not pushed."]);
            expect(state.join(" ")).not.toContain("not public");
        }
    });

    it("names the lookup of the release after the tag push", () => {
        expect(report("release-lookup").where).toBe("stopped while looking up the release");
    });

    it("warns about the publish call and the branch push in flight", () => {
        expect(report("publish", true).state[1]).toContain("gh release view 1.2.3");
        expect(report("publish").state[1]).toBe("The release is not public.");
        expect(report("latest").state).toEqual(["The release 1.2.3 is public.", "The branch main was not pushed."]);
        expect(report("branch", true).state[1]).toContain("git ls-remote origin main");
        expect(report("branch").state[0]).toBe("The release 1.2.3 is public.");
    });
});

describe("StepFailure", () => {
    it("carries the hint and the details", () => {
        const failure = new StepFailure("it broke", "do this", ["a", "b"]);
        expect([failure.message, failure.hint, failure.details, failure.name]).toEqual(["it broke", "do this", ["a", "b"], "StepFailure"]);
        expect(new StepFailure("x", "y").details).toEqual([]);
    });

    it("is resumable unless it says otherwise", () => {
        expect(new StepFailure("x", "y").resumable).toBe(true);
        expect(new StepFailure("x", "y", [], false).resumable).toBe(false);
    });
});
