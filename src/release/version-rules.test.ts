import { describe, expect, it } from "vitest";
import { checkVersionSync, resolveTag, versionEntries } from "./version-rules.js";

const sources = (versions: { manifest?: unknown; pkg?: unknown; lock?: unknown; lockRoot?: string | null } = {}): Parameters<typeof checkVersionSync>[0] => {
    const lockRoot = versions.lockRoot === undefined ? "1.2.3" : versions.lockRoot;
    return {
        manifest: { version: versions.manifest ?? "1.2.3" },
        packageJson: { version: versions.pkg ?? "1.2.3" },
        lock: { version: versions.lock ?? "1.2.3", packages: lockRoot === null ? {} : { "": { version: lockRoot } } },
    };
};
const messages = (problems: ReturnType<typeof checkVersionSync>): string[] => problems.filter((problem) => problem.severity === "error").map((problem) => problem.message);

describe("checkVersionSync", () => {
    it("passes when the four places agree", () => {
        expect(checkVersionSync(sources())).toEqual([]);
    });

    it("names each place that differs from manifest.json", () => {
        expect(messages(checkVersionSync(sources({ pkg: "1.2.4" })))).toEqual(["package.json is 1.2.4 but manifest.json is 1.2.3."]);
        expect(messages(checkVersionSync(sources({ lock: "1.2.2" })))).toEqual(["package-lock.json version is 1.2.2 but manifest.json is 1.2.3."]);
        expect(messages(checkVersionSync(sources({ lockRoot: "1.0.0" })))).toEqual(['package-lock.json packages[""].version is 1.0.0 but manifest.json is 1.2.3.']);
    });

    it("skips the lock root entry when the lockfile has none (lockfile v1)", () => {
        expect(checkVersionSync(sources({ lockRoot: null }))).toEqual([]);
    });

    it("warns, not fails, when there is no package-lock.json", () => {
        const problems = checkVersionSync({ manifest: { version: "1.2.3" }, packageJson: { version: "1.2.3" }, lock: undefined });
        expect(problems).toHaveLength(1);
        expect(problems[0]?.severity).toBe("warning");
    });

    it("rejects a v prefix and a pre-release, in every place", () => {
        expect(messages(checkVersionSync(sources({ manifest: "v1.2.3", pkg: "v1.2.3", lock: "v1.2.3", lockRoot: "v1.2.3" })))).toHaveLength(4);
        const [problem] = checkVersionSync(sources({ manifest: "1.2.3-beta.1", pkg: "1.2.3-beta.1", lock: "1.2.3-beta.1", lockRoot: "1.2.3-beta.1" }));
        expect(problem?.message).toBe('manifest.json is "1.2.3-beta.1", not an x.y.z version.');
        expect(problem?.hint).toContain("pre-release versions are not supported yet");
    });

    it("reports a missing version", () => {
        expect(messages(checkVersionSync({ manifest: {}, packageJson: { version: "1.2.3" }, lock: undefined }))).toContain("manifest.json has no version.");
        expect(messages(checkVersionSync({ manifest: { version: "1.2.3" }, packageJson: undefined, lock: undefined }))).toContain("package.json has no version.");
    });

    it("compares the tag with the manifest version", () => {
        expect(checkVersionSync(sources(), "1.2.3")).toEqual([]);
        expect(messages(checkVersionSync(sources(), "1.2.4"))).toEqual(['tag "1.2.4" does not match manifest.json version 1.2.3.']);
    });

    it("says what is wrong with a v-prefixed tag", () => {
        const problems = checkVersionSync(sources(), "v1.2.3");
        expect(problems.map((problem) => problem.message)).toEqual(['tag "v1.2.3" does not match manifest.json version 1.2.3: Obsidian release tags have no "v" prefix.']);
        expect(problems[0]?.hint).toContain("the tag must be 1.2.3");
    });

    it("does not blame the prefix when the tag differs for another reason", () => {
        expect(messages(checkVersionSync(sources(), "v1.2.4"))).toEqual(['tag "v1.2.4" does not match manifest.json version 1.2.3.']);
    });
});

describe("versionEntries", () => {
    it("lists manifest, package and both lockfile fields", () => {
        expect(versionEntries(sources()).entries.map((entry) => entry.label)).toEqual(["manifest.json", "package.json", "package-lock.json version", 'package-lock.json packages[""].version']);
    });
});

describe("resolveTag", () => {
    it("prefers --tag", () => {
        expect(resolveTag("1.0.0", { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "2.0.0" })).toBe("1.0.0");
    });

    it("takes GITHUB_REF_NAME only when the run is for a tag", () => {
        expect(resolveTag(undefined, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "2.0.0" })).toBe("2.0.0");
        expect(resolveTag(undefined, { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" })).toBeUndefined();
        expect(resolveTag(undefined, { GITHUB_REF_NAME: "2.0.0" })).toBeUndefined();
        expect(resolveTag(undefined, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "" })).toBeUndefined();
        expect(resolveTag(undefined, {})).toBeUndefined();
    });
});
