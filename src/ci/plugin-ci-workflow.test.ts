import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Step {
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    with?: Record<string, unknown>;
}
interface Job {
    "runs-on"?: string;
    permissions?: Record<string, string>;
    steps?: Step[];
}
interface Input {
    type?: string;
    default?: unknown;
}
interface Workflow {
    on?: { workflow_call?: { inputs?: Record<string, Input> } };
    permissions?: Record<string, string>;
    jobs?: Record<string, Job>;
}

const WORKFLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

const load = (name: string): Workflow => parse(fs.readFileSync(path.join(WORKFLOWS_DIR, name), "utf8")) as Workflow;

const steps = (workflow: Workflow): Step[] => Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);

/** Every `uses:` that is not pinned to a 40-character commit SHA. */
const unpinnedActions = (workflow: Workflow): string[] =>
    steps(workflow)
        .map((step) => step.uses)
        .filter((uses): uses is string => uses !== undefined)
        .filter((uses) => !/^[^@\s]+@[0-9a-f]{40}$/.test(uses));

/** Names of the steps whose `run:` script interpolates an expression (script injection). */
const stepsWithExpressionInRun = (workflow: Workflow): string[] =>
    steps(workflow)
        .filter((step) => step.run?.includes("${{") === true)
        .map((step) => step.name ?? step.run ?? "");

/** Jobs whose permissions are anything but exactly `contents: read`. */
const jobsNotReadOnly = (workflow: Workflow): string[] =>
    Object.entries(workflow.jobs ?? {})
        .filter(([, job]) => JSON.stringify(job.permissions) !== JSON.stringify({ contents: "read" }))
        .map(([name]) => name);

describe("the checks themselves", () => {
    const sha = "a".repeat(40);

    it("flags tags, branches, short SHAs and a missing version, accepts a full SHA", () => {
        const workflow: Workflow = {
            jobs: { j: { steps: [{ uses: `actions/checkout@${sha}` }, { uses: "actions/checkout@v7" }, { uses: "actions/checkout@main" }, { uses: `actions/checkout@${"a".repeat(39)}` }, { uses: "actions/checkout" }, { run: "echo" }] } },
        };
        expect(unpinnedActions(workflow)).toEqual(["actions/checkout@v7", "actions/checkout@main", `actions/checkout@${"a".repeat(39)}`, "actions/checkout"]);
    });

    it("flags an expression in run and nothing else", () => {
        const workflow: Workflow = { jobs: { j: { steps: [{ name: "bad", run: "echo ${{ inputs.x }}" }, { name: "env", run: 'echo "$X"' }, { uses: "a/b@v1", with: { x: "${{ inputs.x }}" } }] } } };
        expect(stepsWithExpressionInRun(workflow)).toEqual(["bad"]);
    });

    it("flags a job with write access, with extra permissions, or with none", () => {
        const workflow: Workflow = {
            jobs: { ok: { permissions: { contents: "read" } }, write: { permissions: { contents: "write" } }, extra: { permissions: { contents: "read", "id-token": "write" } }, none: {} },
        };
        expect(jobsNotReadOnly(workflow)).toEqual(["write", "extra", "none"]);
    });
});

describe("release.yml and plugin-ci.yml", () => {
    for (const name of ["release.yml", "plugin-ci.yml"]) {
        describe(name, () => {
            const workflow = load(name);

            it("pins every action to a full commit SHA", () => {
                expect(unpinnedActions(workflow)).toEqual([]);
            });

            it("grants nothing at the top level", () => {
                expect(workflow.permissions).toEqual({});
            });

            it("never puts an expression inside a run script", () => {
                expect(stepsWithExpressionInRun(workflow)).toEqual([]);
            });
        });
    }
});

describe("plugin-ci.yml", () => {
    const workflow = load("plugin-ci.yml");
    const inputs = workflow.on?.workflow_call?.inputs ?? {};
    const job = workflow.jobs?.check;

    it("is a single read-only job", () => {
        expect(Object.keys(workflow.jobs ?? {})).toEqual(["check"]);
        expect(jobsNotReadOnly(workflow)).toEqual([]);
    });

    it("takes switches and two plain values, with the documented defaults", () => {
        expect(Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, [input.type, input.default]]))).toEqual({
            "node-version": ["string", "22"],
            "runs-on": ["string", "ubuntu-24.04"],
            lint: ["boolean", true],
            typecheck: ["boolean", true],
            test: ["boolean", true],
            scan: ["boolean", true],
            "release-check": ["boolean", true],
            build: ["boolean", true],
            "upload-bundle": ["boolean", true],
            "coverage-artifact": ["boolean", false],
        });
    });

    it("gates every optional step on a declared boolean input", () => {
        const gates = steps(workflow)
            .map((step) => step.if)
            .filter((condition): condition is string => condition !== undefined);
        expect(gates.length).toBeGreaterThan(0);
        for (const condition of gates) {
            const match = /^inputs\.([a-z-]+)$/.exec(condition);
            expect(match, `unexpected condition: ${condition}`).not.toBeNull();
            expect(inputs[match?.[1] ?? ""]?.type).toBe("boolean");
        }
    });

    it("checks out without keeping the token", () => {
        const checkout = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout?.with).toEqual({ "persist-credentials": false });
    });

    it("runs the kit from node_modules, never through npx", () => {
        const scripts = steps(workflow)
            .map((step) => step.run ?? "")
            .join("\n");
        expect(scripts).toContain("node_modules/.bin/opdk scan");
        expect(scripts).toContain("node_modules/.bin/opdk release check --no-build --no-api");
        expect(scripts).not.toMatch(/\bnpx\b/);
    });

    it("errors when main.js or manifest.json is missing from the upload", () => {
        const upload = steps(workflow).filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
        expect(upload).toHaveLength(2);
        for (const step of upload) {
            expect(step.with?.["if-no-files-found"]).toBe("error");
        }
        const check = steps(workflow).find((step) => step.name === "Check the bundle");
        expect(check?.run).toContain("main.js manifest.json");
    });

    it("names the artifacts after the manifest id", () => {
        const names = steps(workflow)
            .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
            .map((step) => step.with?.name);
        expect(names).toEqual(["${{ steps.plugin.outputs.id }}-bundle", "${{ steps.plugin.outputs.id }}-coverage"]);
    });
});
