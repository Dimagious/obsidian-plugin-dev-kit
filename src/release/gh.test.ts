import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunGh, describeGhFailure } from "./gh.js";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A folder holding a `gh` shell script, to put first on PATH. */
function fakeGhDir(script: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "opdk-fake-gh-"));
    dirs.push(dir);
    const file = path.join(dir, "gh");
    writeFileSync(file, `#!/bin/sh\n${script}\n`);
    chmodSync(file, 0o755);
    return dir;
}

describe.skipIf(process.platform === "win32")("createRunGh", () => {
    it("passes every argument as one element, never through a shell, and never lets gh or git prompt", async () => {
        const dir = fakeGhDir('printf "%s|" "$@"; printf "%s %s" "$GH_PROMPT_DISABLED" "$GIT_TERMINAL_PROMPT"');
        const gh = createRunGh(dir, { PATH: `${dir}:/usr/bin:/bin` });
        expect(await gh.text(["release", "edit", "1.0.0; echo pwned", "--notes", "two words"])).toBe("release|edit|1.0.0; echo pwned|--notes|two words|1 0");
    });

    it("returns binary output untouched", async () => {
        const dir = fakeGhDir("printf '\\000\\377\\200abc'");
        const gh = createRunGh(dir, { PATH: `${dir}:/usr/bin:/bin` });
        expect([...(await gh.bytes(["api", "x"]))]).toEqual([0, 255, 128, 97, 98, 99]);
    });

    it("drops the variables that point git at another repository", async () => {
        const dir = fakeGhDir('printf "%s" "${GIT_DIR:-unset}"');
        const gh = createRunGh(dir, { PATH: `${dir}:/usr/bin:/bin`, GIT_DIR: "/elsewhere/.git" });
        expect(await gh.text([])).toBe("unset");
    });

    it("fails with gh's own message and the command", async () => {
        const dir = fakeGhDir('echo "HTTP 404: Not Found" >&2; exit 1');
        const gh = createRunGh(dir, { PATH: `${dir}:/usr/bin:/bin` });
        await expect(gh.text(["api", "repos/a/b"])).rejects.toThrow("gh api repos/a/b failed: HTTP 404: Not Found");
        await expect(gh.bytes(["api", "repos/a/b"])).rejects.toThrow("HTTP 404: Not Found");
    });

    it("says how to install gh when it is not on PATH", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "opdk-no-gh-"));
        dirs.push(dir);
        const gh = createRunGh(dir, { PATH: dir });
        await expect(gh.text(["--version"])).rejects.toThrow(/gh is not installed or not on PATH\. Install the GitHub CLI from https:\/\/cli\.github\.com/);
    });
});

describe("describeGhFailure", () => {
    it("falls back to the error text when stderr is empty", () => {
        expect(describeGhFailure(["x"], new Error("boom"))).toBe("gh x failed: Error: boom");
        expect(describeGhFailure(["x"], "plain")).toBe("gh x failed: plain");
    });
});
