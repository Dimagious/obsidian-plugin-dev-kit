import { describe, expect, it } from "vitest";
import { checkBuildScript, DIRECTORY_BUILD_SCRIPTS } from "./build-script.js";

const pkg = (scripts: Record<string, unknown>): unknown => ({ name: "p", scripts });

describe("checkBuildScript", () => {
    it("lists the scripts in the order the directory tries them", () => {
        expect(DIRECTORY_BUILD_SCRIPTS).toEqual(["build", "build:plugin", "compile"]);
    });

    it("is silent when the script the directory runs is opdk build", () => {
        for (const command of ["opdk build", "npx opdk build", "tsc --noEmit && opdk build", "npm run lint && opdk build; echo done", "opdk build --minify"]) {
            expect(checkBuildScript(pkg({ build: command })), command).toEqual([]);
        }
    });

    it("warns, naming the script and its text, when it does not run opdk build", () => {
        const [problem, ...rest] = checkBuildScript(pkg({ build: "node esbuild.config.mjs production" }));
        expect(rest).toEqual([]);
        expect(problem?.severity).toBe("warning");
        expect(problem?.group).toBe("build");
        expect(problem?.message).toContain('scripts.build is "node esbuild.config.mjs production" and does not run `opdk build`');
        expect(problem?.message).toContain("rebuilds main.js with that script");
        expect(problem?.hint).toContain('scripts.build "opdk build"');
    });

    it("does not take opdk build-css or the dev-vault build for the production build", () => {
        for (const command of ["opdk build-css", "opdk build --vault ../vault", "opdk build --watch", "opdk-build"]) {
            expect(checkBuildScript(pkg({ build: command })), command).toHaveLength(1);
        }
    });

    it("judges the first of build, build:plugin and compile that exists, as the directory does", () => {
        expect(checkBuildScript(pkg({ "build:plugin": "opdk build", compile: "tsc" }))).toEqual([]);
        expect(checkBuildScript(pkg({ compile: "opdk build" }))).toEqual([]);
        expect(checkBuildScript(pkg({ build: "tsc", "build:plugin": "opdk build" }))[0]?.message).toContain("scripts.build ");
        expect(checkBuildScript(pkg({ "build:plugin": "tsc", compile: "opdk build" }))[0]?.message).toContain("scripts.build:plugin ");
    });

    it("skips a script that is not a string", () => {
        expect(checkBuildScript(pkg({ build: 5, compile: "opdk build" }))).toEqual([]);
    });

    it("warns when there is no such script, or no scripts or package.json at all", () => {
        for (const value of [pkg({ test: "vitest" }), { name: "p" }, { scripts: "x" }, undefined, null]) {
            const [problem] = checkBuildScript(value);
            expect(problem?.severity, JSON.stringify(value)).toBe("warning");
            expect(problem?.message).toContain('none of the scripts "build", "build:plugin", "compile"');
        }
    });
});
