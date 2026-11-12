import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Step {
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    shell?: string;
    "working-directory"?: string;
    with?: Record<string, unknown>;
}
interface Job {
    "runs-on"?: string;
    permissions?: Record<string, string>;
    defaults?: Defaults;
    steps?: Step[];
}
interface Defaults {
    run?: { shell?: string; "working-directory"?: string };
}
interface Input {
    type?: string;
    default?: unknown;
}
interface Workflow {
    on?: { workflow_call?: { inputs?: Record<string, Input> } };
    permissions?: Record<string, string>;
    defaults?: Defaults;
    jobs?: Record<string, Job>;
}

const WORKFLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

const readRaw = (name: string): string => fs.readFileSync(path.join(WORKFLOWS_DIR, name), "utf8");

const load = (name: string): Workflow => parse(readRaw(name)) as Workflow;

const steps = (workflow: Workflow): Step[] => Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);

/** Every `uses:` that is not pinned to a 40-character commit SHA. */
const unpinnedActions = (workflow: Workflow): string[] =>
    steps(workflow)
        .map((step) => step.uses)
        .filter((uses): uses is string => uses !== undefined)
        .filter((uses) => !/^[^@\s]+@[0-9a-f]{40}$/.test(uses));

/** Names of the steps whose `run:`, `shell:` or `working-directory:` interpolates an expression (script injection). */
const stepsWithExpressionInRun = (workflow: Workflow): string[] =>
    steps(workflow)
        .filter((step) => [step.run, step.shell, step["working-directory"]].some((value) => value?.includes("${{") === true))
        .map((step) => step.name ?? step.run ?? "");

/** Places outside the steps where a caller-controlled expression would pick the shell or the directory of a script. */
const defaultsWithExpression = (workflow: Workflow): string[] => {
    const places: [string, Defaults | undefined][] = [
        ["workflow", workflow.defaults],
        ...Object.entries(workflow.jobs ?? {}).map(([name, job]): [string, Defaults | undefined] => [`job ${name}`, job.defaults]),
    ];
    return places.filter(([, defaults]) => JSON.stringify(defaults ?? {}).includes("${{")).map(([where]) => where);
};

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

    it("flags an expression in shell, working-directory and the defaults", () => {
        const workflow: Workflow = {
            defaults: { run: { shell: "${{ inputs.s }}" } },
            jobs: {
                j: { defaults: { run: { "working-directory": "${{ inputs.d }}" } }, steps: [{ name: "s", run: "x", shell: "${{ inputs.s }}" }, { name: "w", run: "x", "working-directory": "${{ inputs.d }}" }] },
                k: { defaults: { run: { shell: "bash" } } },
            },
        };
        expect(stepsWithExpressionInRun(workflow)).toEqual(["s", "w"]);
        expect(defaultsWithExpression(workflow)).toEqual(["workflow", "job j"]);
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

            it("has a version comment on every pinned action", () => {
                // yaml.parse drops comments, so this reads the raw text.
                const uses = readRaw(name)
                    .split("\n")
                    .filter((line) => /^\s*(-\s+)?uses:/.test(line) && !line.includes("./"));
                expect(uses.length).toBeGreaterThan(0);
                for (const line of uses) {
                    expect(line, `no version comment: ${line}`).toMatch(/@[0-9a-f]{40} # v\d/);
                }
            });

            it("never puts an expression inside a run script, shell or working directory", () => {
                expect(stepsWithExpressionInRun(workflow)).toEqual([]);
                expect(defaultsWithExpression(workflow)).toEqual([]);
            });
        });
    }
});

describe("release.yml runner", () => {
    const workflow = load("release.yml");

    it("takes runs-on as a plain string input that defaults to ubuntu-24.04", () => {
        const input = workflow.on?.workflow_call?.inputs?.["runs-on"];
        expect(input?.type).toBe("string");
        expect(input?.default).toBe("ubuntu-24.04");
    });

    it("runs every job on that input and never on ubuntu-latest", () => {
        const jobs = Object.entries(workflow.jobs ?? {});
        expect(jobs.map(([name]) => name)).toEqual(["build", "release"]);
        for (const [name, job] of jobs) {
            expect(job["runs-on"], `job ${name}`).toBe("${{ inputs.runs-on }}");
        }
        expect(readRaw("release.yml")).not.toContain("ubuntu-latest");
    });
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

    it("runs the steps in this order, each behind the switch that names it", () => {
        expect(steps(workflow).map((step) => [step.name ?? step.uses?.split("@")[0], step.if])).toEqual([
            ["actions/checkout", undefined],
            ["actions/setup-node", undefined],
            ["Read the plugin id", undefined],
            ["Install", undefined],
            ["Lint", "inputs.lint"],
            ["Typecheck", "inputs.typecheck"],
            ["Unit tests", "inputs.test"],
            ["Scanner", "inputs.scan"],
            ["Release check", "inputs.release-check"],
            ["Build", "inputs.build"],
            ["Check the bundle", "inputs.upload-bundle"],
            ["Upload the plugin bundle", "inputs.upload-bundle"],
            ["Upload the coverage report", "inputs.coverage-artifact"],
        ]);
    });

    it("lets every boolean input gate at least one step, and only boolean inputs gate", () => {
        const gated = new Set(steps(workflow).map((step) => /^inputs\.([a-z-]+)$/.exec(step.if ?? "")?.[1]));
        const booleans = Object.keys(inputs).filter((name) => inputs[name]?.type === "boolean");
        expect(booleans.length).toBeGreaterThan(0);
        for (const name of booleans) {
            expect(gated.has(name), `${name} gates no step`).toBe(true);
        }
        for (const name of gated) {
            if (name !== undefined) expect(inputs[name]?.type).toBe("boolean");
        }
    });

    it("installs with npm ci and nothing else", () => {
        expect(steps(workflow).find((step) => step.name === "Install")?.run).toBe("npm ci");
    });

    it("runs every script with bash", () => {
        expect(job?.defaults?.run?.shell).toBe("bash");
    });

    it("never touches a secret", () => {
        expect(JSON.stringify(workflow)).not.toContain("secrets.");
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

describe("the step that reads the plugin id", () => {
    const script = steps(load("plugin-ci.yml")).find((step) => step.name === "Read the plugin id")?.run ?? "";
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    /** Runs the step's own script with bash in a temp plugin folder holding the given manifest text. */
    const run = (manifest: string): { status: number | null; output: string; stdout: string } => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-ci-id-"));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, "manifest.json"), manifest);
        const output = path.join(dir, "github-output");
        fs.writeFileSync(output, "");
        const result = spawnSync("bash", ["-c", script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: "utf8" });
        return { status: result.status, output: fs.readFileSync(output, "utf8"), stdout: result.stdout };
    };

    it("has a script to run", () => {
        expect(script).toContain("GITHUB_OUTPUT");
    });

    it("writes a valid id to the step output", () => {
        const result = run(JSON.stringify({ id: "my-plugin_2.x" }));
        expect(result.status).toBe(0);
        expect(result.output).toBe("id=my-plugin_2.x\n");
    });

    it.each([
        ["missing", JSON.stringify({ name: "x" })],
        ["empty", JSON.stringify({ id: "" })],
        ["numeric", JSON.stringify({ id: 42 })],
        ["an object", JSON.stringify({ id: { a: 1 } })],
        ["a single dot", JSON.stringify({ id: "." })],
        ["a parent directory", JSON.stringify({ id: ".." })],
        ["a slash", JSON.stringify({ id: "a/b" })],
        ["a path traversal", JSON.stringify({ id: "../x" })],
        ["a newline", JSON.stringify({ id: "ok\nid=evil" })],
        ["a space", JSON.stringify({ id: "a b" })],
    ])("rejects an id that is %s and writes no output", (_label, manifest) => {
        const result = run(manifest);
        expect(result.status).not.toBe(0);
        expect(result.output).toBe("");
        expect(result.stdout).toContain("::error::");
    });

    it("fails without an output when manifest.json is not JSON", () => {
        const result = run("{ not json");
        expect(result.status).not.toBe(0);
        expect(result.output).toBe("");
    });
});

