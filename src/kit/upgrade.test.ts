import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LS_REMOTE, lockText, NEW_SHA, OLD_SHA, packageJsonText, workflowText } from "../test-support/kit-fixture.js";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { runKitUpgrade, type UpgradeDeps } from "./upgrade.js";

const KIT_CHANGELOG = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "- Not released.",
    "",
    "## [0.2.0] - 2026-11-20",
    "",
    "### Added",
    "",
    "- `opdk kit upgrade`.",
    "",
    "## [0.1.0] - 2026-11-12",
    "",
    "- First release.",
    "",
].join("\n");

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

/** A plugin on kit 0.1.0 in all three places: package.json, the lockfile and two workflows. */
function pluginOnOldKit(): PluginFixture {
    const created = createPluginFixture();
    plugin = created;
    created.write("package.json", packageJsonText("v0.1.0"));
    created.write("package-lock.json", lockText(OLD_SHA, "0.1.0"));
    created.write(".github/workflows/ci.yml", workflowText("plugin-ci.yml", OLD_SHA, "v0.1.0"));
    created.write(".github/workflows/release.yml", workflowText("release.yml", OLD_SHA, undefined));
    return created;
}

const read = (created: PluginFixture, file: string): string => readFileSync(path.join(created.dir, file), "utf8");
const snapshot = (created: PluginFixture): string[] => ["package.json", "package-lock.json", ".github/workflows/ci.yml", ".github/workflows/release.yml"].map((file) => read(created, file));

interface Recorded {
    readonly gitCalls: string[][];
    readonly npmCalls: string[][];
    readonly fetched: string[];
}

interface Options {
    readonly target?: string;
    readonly dryRun?: boolean;
    readonly status?: string;
    readonly inside?: boolean;
    readonly lsRemote?: string | Error;
    readonly npm?: (created: PluginFixture) => Error | undefined;
    readonly changelog?: string | Error;
}

async function upgrade(created: PluginFixture, options: Options = {}): Promise<{ code: number; out: string; err: string; printed: string; recorded: Recorded }> {
    const ctx = createContext(created.dir);
    const printed: string[] = [];
    const recorded: Recorded = { gitCalls: [], npmCalls: [], fetched: [] };
    const deps: UpgradeDeps = {
        run: (args) => {
            recorded.gitCalls.push([...args]);
            if (args[0] === "rev-parse") {
                return options.inside === false ? Promise.reject(new Error("not a repository")) : Promise.resolve("true\n");
            }
            if (args[0] === "status") {
                return Promise.resolve(options.status ?? "");
            }
            const listed = options.lsRemote ?? LS_REMOTE;
            return listed instanceof Error ? Promise.reject(listed) : Promise.resolve(listed);
        },
        npm: (args) => {
            recorded.npmCalls.push([...args]);
            const failure = options.npm?.(created);
            return failure instanceof Error ? Promise.reject(failure) : Promise.resolve();
        },
        fetchText: (url) => {
            recorded.fetched.push(url);
            const text = options.changelog ?? KIT_CHANGELOG;
            return text instanceof Error ? Promise.reject(text) : Promise.resolve(text);
        },
    };
    const code = await runKitUpgrade({ cwd: created.dir, target: options.target, dryRun: options.dryRun ?? false, reporter: ctx.reporter, stdout: (text) => printed.push(text), deps });
    return { code, out: ctx.out.join(""), err: ctx.err.join(""), printed: printed.join(""), recorded };
}

/** What npm does to the lockfile when it installs the new tag. */
const npmRewritesLock = (created: PluginFixture): undefined => {
    created.write("package-lock.json", lockText(NEW_SHA, "0.2.0"));
    return undefined;
};

describe("opdk kit upgrade --dry-run", () => {
    it("prints the lines that would change and the kit changelog, and writes nothing", async () => {
        const created = pluginOnOldKit();
        const before = snapshot(created);
        const result = await upgrade(created, { dryRun: true });

        expect(result.code).toBe(0);
        expect(snapshot(created)).toEqual(before);
        expect(result.recorded.npmCalls).toEqual([]);
        expect(result.out).toContain("· kit     kit v0.1.0 -> v0.2.0 (a1b2c3d) (dry run)");
        expect(result.printed).toContain('package.json:5\n- "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.1.0",\n+ "obsidian-plugin-dev-kit": "github:Dimagious/obsidian-plugin-dev-kit#v0.2.0",');
        expect(result.printed).toContain(`.github/workflows/ci.yml:6\n- uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/plugin-ci.yml@${OLD_SHA} # v0.1.0\n+ uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/plugin-ci.yml@${NEW_SHA} # v0.2.0`);
        expect(result.printed).toContain(`.github/workflows/release.yml:6\n- uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@${OLD_SHA}\n+ uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@${NEW_SHA} # v0.2.0`);
        expect(result.out).toContain("· kit     package-lock.json: 6e33ca4 -> a1b2c3d, rewritten by `npm install`");
        expect(result.out).toContain("· kit     kit changes since 0.1.0, newest first:");
        expect(result.printed).toContain("## [0.2.0] - 2026-11-20\n\n### Added\n\n- `opdk kit upgrade`.");
        expect(result.printed).not.toContain("First release");
        expect(result.printed).not.toContain("Not released");
        expect(result.recorded.fetched).toEqual(["https://raw.githubusercontent.com/Dimagious/obsidian-plugin-dev-kit/v0.2.0/CHANGELOG.md"]);
        expect(result.out).toContain("dry run: nothing was written");
    });

    it("works on a dirty tree and outside a git repository, without asking git about either", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { dryRun: true, status: " M src/main.ts\n", inside: false });
        expect(result.code).toBe(0);
        expect(result.recorded.gitCalls.map((call) => call[0])).toEqual(["ls-remote"]);
    });

    it("reports nothing to change when everything already names the tag, comment or not", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { dryRun: true, target: "v0.1.0" });
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ kit     package.json, package-lock.json and the workflow pins are already at v0.1.0 (6e33ca4); nothing to change.");
        expect(result.printed).toBe("");
        expect(result.recorded.fetched).toEqual([]);
    });
});

describe("opdk kit upgrade", () => {
    it("takes the latest release when no tag is given, rewrites all three places and runs the kit check", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { npm: npmRewritesLock });

        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(result.recorded.npmCalls).toEqual([["install", "--no-audit", "--no-fund", "obsidian-plugin-dev-kit@github:Dimagious/obsidian-plugin-dev-kit#v0.2.0"]]);
        expect(read(created, "package.json")).toBe(packageJsonText("v0.2.0"));
        expect(read(created, ".github/workflows/ci.yml")).toBe(workflowText("plugin-ci.yml", NEW_SHA, "v0.2.0"));
        expect(read(created, ".github/workflows/release.yml")).toBe(workflowText("release.yml", NEW_SHA, "v0.2.0"));
        expect(result.out).toContain("✓ kit     package.json, package-lock.json and 2 workflow file(s) now point at v0.2.0 (a1b2c3d)");
        expect(result.out).toContain("✓ check   kit: the kit is v0.2.0 (a1b2c3d) in package.json, package-lock.json, 2 workflow lines");
        expect(result.out).toContain("nothing was committed");
        expect(result.recorded.gitCalls.map((call) => call[0])).toEqual(["rev-parse", "status", "ls-remote"]);
        expect(result.recorded.gitCalls[2]).toEqual(["ls-remote", "--tags", "https://github.com/Dimagious/obsidian-plugin-dev-kit.git"]);
    });

    it("takes the tag it is given, with or without the v already added by the caller", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { target: "v0.2.0", npm: npmRewritesLock });
        expect(result.code).toBe(0);
        expect(read(created, "package.json")).toContain("#v0.2.0");
    });

    it("repairs drift without npm when the lockfile already holds the commit", async () => {
        const created = pluginOnOldKit();
        created.write("package.json", packageJsonText("v0.2.0"));
        created.write("package-lock.json", lockText(NEW_SHA, "0.2.0"));
        const result = await upgrade(created, { target: "v0.2.0" });
        expect(result.code).toBe(0);
        expect(result.recorded.npmCalls).toEqual([]);
        expect(read(created, ".github/workflows/ci.yml")).toBe(workflowText("plugin-ci.yml", NEW_SHA, "v0.2.0"));
        expect(result.out).toContain("✓ check   kit:");
    });

    it("puts package.json and the lockfile back when npm fails, and leaves the workflows alone", async () => {
        const created = pluginOnOldKit();
        const before = snapshot(created);
        const result = await upgrade(created, {
            npm: (target) => {
                target.write("package-lock.json", "{ half written");
                return new Error("npm install failed: ETIMEDOUT");
            },
        });
        expect(result.code).toBe(1);
        expect(snapshot(created)).toEqual(before);
        expect(result.err).toContain("✗ kit     npm install failed, so nothing was changed: npm install failed: ETIMEDOUT");
        expect(result.err).toContain("opdk kit upgrade v0.2.0` for the workflow pins");
    });

    it("fails the run when the three places still disagree after npm (it resolved something else)", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { npm: () => undefined });
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ check   kit: the kit is not pinned to one release.");
        expect(result.err).toContain("package.json asks for v0.2.0, but the lockfile holds kit version 0.1.0.");
    });

    it("warns when there is no lockfile and skips npm", async () => {
        const created = pluginOnOldKit();
        rmSync(path.join(created.dir, "package-lock.json"));
        const result = await upgrade(created);
        expect(result.code).toBe(0);
        expect(result.recorded.npmCalls).toEqual([]);
        expect(result.out).toContain("! kit     there is no package-lock.json; run `npm install` yourself to create one.");
        expect(read(created, "package.json")).toContain("#v0.2.0");
    });

    it("says what it could not read when the kit changelog is unreachable, and goes on", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { dryRun: true, changelog: new Error("ENOTFOUND") });
        expect(result.code).toBe(0);
        expect(result.out).toContain("· kit     could not read the kit CHANGELOG (ENOTFOUND); see https://raw.githubusercontent.com/Dimagious/obsidian-plugin-dev-kit/v0.2.0/CHANGELOG.md");
    });

    it("says so when the changelog has nothing newer, and warns about a downgrade instead of printing one", async () => {
        const created = pluginOnOldKit();
        expect((await upgrade(created, { dryRun: true, changelog: "# Changelog\n" })).out).toContain("has no section after 0.1.0");
        created.write("package.json", packageJsonText("v0.2.0"));
        created.write("package-lock.json", lockText(NEW_SHA, "0.2.0"));
        const down = await upgrade(created, { dryRun: true, target: "v0.1.0" });
        expect(down.out).toContain("! kit     v0.1.0 is older than 0.2.0: this is a downgrade.");
        expect(down.printed).not.toContain("## [");
    });
});

describe("opdk kit upgrade refuses", () => {
    it("a dirty tree, before writing anything", async () => {
        const created = pluginOnOldKit();
        const before = snapshot(created);
        const result = await upgrade(created, { status: " M src/main.ts\n?? notes.txt\n" });
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ kit     the working tree is not clean ( M src/main.ts, ?? notes.txt).");
        expect(result.err).toContain("--dry-run works on a dirty tree");
        expect(snapshot(created)).toEqual(before);
        expect(result.recorded.npmCalls).toEqual([]);
    });

    it("a folder that is not a git repository", async () => {
        const created = pluginOnOldKit();
        const result = await upgrade(created, { inside: false });
        expect(result.code).toBe(1);
        expect(result.err).toContain("this folder is not inside a git repository.");
    });

    it("a tag the kit does not have, naming the latest ones", async () => {
        const result = await upgrade(pluginOnOldKit(), { target: "v9.9.9" });
        expect(result.code).toBe(1);
        expect(result.err).toContain("the kit has no release tag v9.9.9.");
        expect(result.err).toContain("The latest tags are: v0.2.0, v0.1.0.");
    });

    it("an origin it cannot list, and a repository without release tags", async () => {
        const unreachable = await upgrade(pluginOnOldKit(), { lsRemote: new Error("git ls-remote failed: could not resolve host") });
        expect(unreachable.code).toBe(1);
        expect(unreachable.err).toContain("could not list the kit's release tags: git ls-remote failed: could not resolve host");

        const empty = await upgrade(pluginOnOldKit(), { lsRemote: "" });
        expect(empty.code).toBe(1);
        expect(empty.err).toContain("has no vX.Y.Z release tag.");

        const named = await upgrade(pluginOnOldKit(), { lsRemote: "", target: "v0.2.0" });
        expect(named.err).toContain("the kit has no release tag v0.2.0.");
        expect(named.err).toContain("Check the spelling.");
    });

    it("a package.json that is missing, invalid or does not use the kit through GitHub", async () => {
        const created = createPluginFixture();
        plugin = created;
        expect((await upgrade(created)).err).toContain("package.json is missing in");
        created.write("package.json", "{ nope");
        expect((await upgrade(created)).err).toContain("package.json is not valid JSON");
        created.write("package.json", JSON.stringify({ devDependencies: { "obsidian-plugin-dev-kit": "file:../kit" } }));
        const result = await upgrade(created);
        expect(result.code).toBe(1);
        expect(result.err).toContain("package.json does not depend on obsidian-plugin-dev-kit through GitHub.");
    });

    it("a lockfile that is not valid JSON", async () => {
        const created = pluginOnOldKit();
        created.write("package-lock.json", "{ nope");
        const result = await upgrade(created);
        expect(result.code).toBe(1);
        expect(result.err).toContain("package-lock.json is not valid JSON");
    });
});
