/** Where the push flow is; Ctrl+C and every failure report it, so the owner knows what is on origin. */
export type Stage = "preflight" | "gh" | "tag" | "workflow" | "verify" | "publish" | "latest" | "branch";

const LABEL: Record<Stage, string> = {
    preflight: "checking the tag and the branch",
    gh: "checking the GitHub CLI",
    tag: "pushing the tag",
    workflow: "waiting for the release workflow",
    verify: "verifying the draft release",
    publish: "publishing the release",
    latest: "confirming the latest release",
    branch: "pushing the branch",
};

export interface StopReport {
    /** Where it stopped, as a sentence fragment: "while waiting for the release workflow". */
    readonly where: string;
    /** What is on origin and what is not. */
    readonly state: readonly string[];
    /** The command that continues from here. */
    readonly resume: string;
}

/**
 * What is on origin when the flow stops at `stage`. The steps are idempotent, so `opdk release publish <version>`
 * continues from any of them; a step that was in flight when Ctrl+C arrived says what to check first.
 */
export function stopReport(stage: Stage, version: string, branch: string, options: { readonly interrupted: boolean }): StopReport {
    const resume = `opdk release publish ${version}`;
    const where = `${options.interrupted ? "interrupted " : "stopped "}while ${LABEL[stage]}`;
    const inFlight = options.interrupted;
    switch (stage) {
        case "preflight":
        case "gh":
            return { where, state: ["Nothing was pushed."], resume };
        case "tag":
            return {
                where,
                state: [inFlight ? `The push of the tag ${version} was in flight: check \`git ls-remote --tags origin ${version}\` to see whether it arrived.` : `The tag ${version} was not pushed.`, "The branch was not pushed."],
                resume,
            };
        case "workflow":
        case "verify":
            return { where, state: [`The tag ${version} is on origin.`, "The release is not public (a draft at most).", `The branch ${branch} was not pushed.`], resume };
        case "publish":
            return {
                where,
                state: [`The tag ${version} is on origin.`, inFlight ? `Publishing was in flight: check \`gh release view ${version}\` to see whether the release is public.` : "The release is not public.", `The branch ${branch} was not pushed.`],
                resume,
            };
        case "latest":
            return { where, state: [`The release ${version} is public.`, `The branch ${branch} was not pushed.`], resume };
        case "branch":
            return {
                where,
                state: [`The release ${version} is public.`, inFlight ? `The push of ${branch} was in flight: check \`git ls-remote origin ${branch}\`.` : `The branch ${branch} was not pushed.`],
                resume,
            };
    }
}

/** A failure of one step, with what to do about it. The flow turns it into one `✗` line and the stop report. */
export class StepFailure extends Error {
    constructor(
        message: string,
        readonly hint: string,
        readonly details: readonly string[] = [],
    ) {
        super(message);
        this.name = "StepFailure";
    }
}
