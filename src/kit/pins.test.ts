import { describe, expect, it } from "vitest";
import { lockText, NEW_SHA, OLD_SHA, packageJsonText, workflowText } from "../test-support/kit-fixture.js";
import { isFullSha, judgePins, parseKitSpec, readKitPins, readLockPin, readPackageJsonPins, readUsesPins, rewritePackageJson, rewriteWorkflow, shortSha, stripV } from "./pins.js";

const ci = (sha: string, comment: string | undefined) => ({ file: ".github/workflows/ci.yml", text: workflowText("plugin-ci.yml", sha, comment) });

describe("parseKitSpec", () => {
    it("reads the spec forms npm writes", () => {
        expect(parseKitSpec("github:Dimagious/obsidian-plugin-dev-kit#v0.1.0")).toEqual({ owner: "Dimagious", ref: "v0.1.0" });
        expect(parseKitSpec(`git+ssh://git@github.com/Dimagious/obsidian-plugin-dev-kit.git#${OLD_SHA}`)).toEqual({ owner: "Dimagious", ref: OLD_SHA });
        expect(parseKitSpec("git+https://github.com/me/obsidian-plugin-dev-kit.git#main")).toEqual({ owner: "me", ref: "main" });
    });

    it("rejects other packages, folders and a spec without a ref", () => {
        for (const spec of ["file:../kit", "^0.1.0", "github:Dimagious/other-repo#v1.0.0", "github:Dimagious/obsidian-plugin-dev-kit", "https://example.com/Dimagious/obsidian-plugin-dev-kit#v1"]) {
            expect(parseKitSpec(spec), spec).toBeUndefined();
        }
    });
});

describe("small helpers", () => {
    it("tell a full commit from a short one and strip the v", () => {
        expect(isFullSha(OLD_SHA)).toBe(true);
        expect(isFullSha("6e33ca4")).toBe(false);
        expect(isFullSha(OLD_SHA.toUpperCase())).toBe(false);
        expect(shortSha(OLD_SHA)).toBe("6e33ca4");
        expect(stripV("v0.1.0")).toBe("0.1.0");
        expect(stripV("0.1.0")).toBe("0.1.0");
    });
});

describe("reading the pins", () => {
    it("finds the kit in any dependency section and ignores other packages", () => {
        const pins = readPackageJsonPins({ dependencies: { "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.2.0", left: "^1.0.0" }, devDependencies: { "obsidian-plugin-dev-kit": "file:../kit" } });
        expect(pins).toEqual([{ section: "dependencies", spec: "github:Dimagious/obsidian-plugin-dev-kit#v0.2.0", parsed: { owner: "Dimagious", ref: "v0.2.0" } }]);
        expect(readPackageJsonPins(undefined)).toEqual([]);
        expect(readPackageJsonPins({ devDependencies: { "obsidian-plugin-dev-kit": 3 } })).toEqual([]);
    });

    it("reads the resolved commit and version from the lockfile", () => {
        expect(readLockPin(JSON.parse(lockText(OLD_SHA, "0.1.0")))).toEqual({ version: "0.1.0", commit: OLD_SHA });
        expect(readLockPin({ packages: { "node_modules/obsidian-plugin-dev-kit": { version: "0.1.0", resolved: "https://registry.npmjs.org/x.tgz" } } })).toEqual({ version: "0.1.0", commit: undefined });
        expect(readLockPin({ packages: {} })).toBeUndefined();
        expect(readLockPin("nope")).toBeUndefined();
    });

    it("finds the kit's uses: lines with their line number and comment tag, and skips everything else", () => {
        const text = [
            "jobs:",
            `  a:`,
            `    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/plugin-ci.yml@${OLD_SHA} # v0.1.0`,
            `  b:`,
            `    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@${OLD_SHA}`,
            `  c:`,
            `    # uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/old.yml@${OLD_SHA}`,
            `    uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@main # not a tag`,
            `    steps:`,
            `      - uses: actions/checkout@v4`,
            `      - uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/x.yml@${OLD_SHA}   #   0.1.0 extra`,
            "",
        ].join("\r\n");
        expect(readUsesPins([{ file: "w.yml", text }])).toEqual([
            { file: "w.yml", line: 3, owner: "Dimagious", ref: OLD_SHA, commentTag: "v0.1.0" },
            { file: "w.yml", line: 5, owner: "Dimagious", ref: OLD_SHA, commentTag: undefined },
            { file: "w.yml", line: 8, owner: "Dimagious", ref: "main", commentTag: undefined },
            { file: "w.yml", line: 11, owner: "Dimagious", ref: OLD_SHA, commentTag: "0.1.0" },
        ]);
    });
});

describe("judgePins", () => {
    const pins = (tag: string, lockSha: string, lockVersion: string, wfSha: string, comment: string | undefined) =>
        readKitPins({ packageJson: JSON.parse(packageJsonText(tag)), lock: JSON.parse(lockText(lockSha, lockVersion)), workflows: [ci(wfSha, comment)] });

    it("agrees when the tag, the lockfile and the workflows name one release", () => {
        const verdict = judgePins(pins("v0.1.0", OLD_SHA, "0.1.0", OLD_SHA, "v0.1.0"));
        expect(verdict).toMatchObject({ reasons: [], tag: "v0.1.0", commit: OLD_SHA, usesCount: 1 });
        expect(verdict.places).toEqual(["package.json (devDependencies): v0.1.0", "package-lock.json: commit 6e33ca4, version 0.1.0", ".github/workflows/ci.yml:6: commit 6e33ca4 (# v0.1.0)"]);
    });

    it("agrees without a comment and without a lockfile", () => {
        expect(judgePins(pins("v0.1.0", OLD_SHA, "0.1.0", OLD_SHA, undefined)).reasons).toEqual([]);
        expect(judgePins(readKitPins({ packageJson: JSON.parse(packageJsonText("v0.1.0")), lock: undefined, workflows: [ci(OLD_SHA, "v0.1.0")] })).reasons).toEqual([]);
    });

    it("names the tag versus lockfile mismatch", () => {
        const verdict = judgePins(pins("v0.2.0", OLD_SHA, "0.1.0", OLD_SHA, "v0.2.0"));
        expect(verdict.reasons).toEqual(["package.json asks for v0.2.0, but the lockfile holds kit version 0.1.0."]);
    });

    it("names a workflow whose commit differs", () => {
        const verdict = judgePins(pins("v0.1.0", OLD_SHA, "0.1.0", NEW_SHA, "v0.1.0"));
        expect(verdict.reasons).toEqual(["the places below name 2 different commits of the kit."]);
        expect(verdict.commit).toBeUndefined();
    });

    it("names a comment that says another tag", () => {
        const verdict = judgePins(pins("v0.1.0", OLD_SHA, "0.1.0", OLD_SHA, "v0.2.0"));
        expect(verdict.reasons).toEqual([".github/workflows/ci.yml:6 says # v0.2.0, but the kit is at 0.1.0."]);
    });

    it("compares a comment with the lockfile version when package.json names a commit", () => {
        const sha = readKitPins({ packageJson: { devDependencies: { "obsidian-plugin-dev-kit": `github:Dimagious/obsidian-plugin-dev-kit#${OLD_SHA}` } }, lock: JSON.parse(lockText(OLD_SHA, "0.1.0")), workflows: [ci(OLD_SHA, "v0.2.0")] });
        expect(judgePins(sha).reasons).toEqual([".github/workflows/ci.yml:6 says # v0.2.0, but the kit is at 0.1.0."]);
    });

    it("rejects a workflow pinned to a ref that is not a commit", () => {
        const verdict = judgePins(pins("v0.1.0", OLD_SHA, "0.1.0", "v0.1.0", undefined));
        expect(verdict.reasons).toEqual([`.github/workflows/ci.yml:6 pins the kit's workflow to "v0.1.0", not to a full commit SHA.`]);
    });

    it("notes a lockfile entry without a commit", () => {
        const verdict = judgePins(readKitPins({ packageJson: JSON.parse(packageJsonText("v0.1.0")), lock: { packages: { "node_modules/obsidian-plugin-dev-kit": { version: "0.1.0", resolved: "https://x/y.tgz" } } }, workflows: [] }));
        expect(verdict.reasons).toEqual([]);
        expect(verdict.places[1]).toBe("package-lock.json: no commit in `resolved`, version 0.1.0");
    });
});

describe("rewritePackageJson", () => {
    it("changes only the kit's tag and keeps the rest byte for byte", () => {
        const before = packageJsonText("v0.1.0");
        const { text, changes } = rewritePackageJson(before, "v0.2.0");
        expect(text).toBe(before.replace("#v0.1.0", "#v0.2.0"));
        expect(changes).toEqual([{ line: 5, before: '    "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.1.0",', after: '    "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.2.0",' }]);
    });

    it("changes nothing when the tag is already there, and leaves other specs alone", () => {
        const same = packageJsonText("v0.2.0");
        expect(rewritePackageJson(same, "v0.2.0")).toEqual({ text: same, changes: [] });
        const linked = '{\n  "devDependencies": {\n    "obsidian-plugin-dev-kit": "file:../kit"\n  }\n}\n';
        expect(rewritePackageJson(linked, "v0.2.0")).toEqual({ text: linked, changes: [] });
    });

    it("keeps CRLF line endings", () => {
        const before = packageJsonText("v0.1.0").replace(/\n/g, "\r\n");
        const { text } = rewritePackageJson(before, "v0.2.0");
        expect(text).toBe(before.replace("#v0.1.0", "#v0.2.0"));
    });
});

describe("rewriteWorkflow", () => {
    it("sets the commit and the tag comment, and leaves other actions alone", () => {
        const before = workflowText("plugin-ci.yml", OLD_SHA, "v0.1.0");
        const { text, changes } = rewriteWorkflow(before, NEW_SHA, "v0.2.0");
        expect(text).toBe(before.replace(OLD_SHA, NEW_SHA).replace("# v0.1.0\n  other", "# v0.2.0\n  other"));
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ line: 6 });
        expect(text).toContain("actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4.2.0");
    });

    it("adds a comment where there is none, keeps the rest of a version comment, and leaves another comment alone", () => {
        expect(rewriteWorkflow(workflowText("release.yml", OLD_SHA, undefined), NEW_SHA, "v0.2.0").text).toContain(`release.yml@${NEW_SHA} # v0.2.0\n`);
        expect(rewriteWorkflow(workflowText("release.yml", OLD_SHA, "0.1.0 (pinned)"), NEW_SHA, "v0.2.0").text).toContain(`@${NEW_SHA} # v0.2.0 (pinned)\n`);
        expect(rewriteWorkflow(workflowText("release.yml", OLD_SHA, "keep me"), NEW_SHA, "v0.2.0").text).toContain(`@${NEW_SHA} # keep me\n`);
    });

    it("leaves a line at the commit alone when it has no comment", () => {
        const bare = workflowText("plugin-ci.yml", NEW_SHA, undefined);
        expect(rewriteWorkflow(bare, NEW_SHA, "v0.2.0")).toEqual({ text: bare, changes: [] });
        const stale = workflowText("plugin-ci.yml", NEW_SHA, "v0.1.0");
        expect(rewriteWorkflow(stale, NEW_SHA, "v0.2.0").changes).toHaveLength(1);
    });

    it("reports nothing for a line that is already right, and keeps CRLF", () => {
        const right = workflowText("plugin-ci.yml", NEW_SHA, "v0.2.0");
        expect(rewriteWorkflow(right, NEW_SHA, "v0.2.0")).toEqual({ text: right, changes: [] });
        const crlf = workflowText("plugin-ci.yml", OLD_SHA, "v0.1.0").replace(/\n/g, "\r\n");
        const rewritten = rewriteWorkflow(crlf, NEW_SHA, "v0.2.0").text;
        expect(rewritten).toBe(crlf.replace(OLD_SHA, NEW_SHA).replace("# v0.1.0", "# v0.2.0"));
    });
});
