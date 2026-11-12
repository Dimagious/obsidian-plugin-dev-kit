import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// vite is not declared: it comes with vitest (a peer of vitest that npm installs); the test compares with Vite's own
// function and would need vite declared under a strict layout such as pnpm.
import { searchForWorkspaceRoot } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot } from "./workspace-root.js";

let base: string;

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opdk-workspace-root-")));
});
afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

function write(file: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), content);
}

describe("findWorkspaceRoot", () => {
    it("is the nearest folder with a package.json when nothing marks a workspace", () => {
        write("a/package.json", "{}");
        write("a/b/c/.keep", "");
        // Nothing above `base` is a workspace in the temp folder, so only the package folder qualifies.
        expect(findWorkspaceRoot(path.join(base, "a/b/c"))).toBe(path.join(base, "a"));
    });

    it("finds a package.json with workspaces above the plugin", () => {
        write("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
        write("packages/p/package.json", "{}");
        expect(findWorkspaceRoot(path.join(base, "packages/p"))).toBe(base);
    });

    it("finds pnpm-workspace.yaml and lerna.json", () => {
        write("pnpm/pnpm-workspace.yaml", "packages: []\n");
        write("pnpm/p/package.json", "{}");
        write("lerna/lerna.json", "{}");
        write("lerna/p/package.json", "{}");
        expect(findWorkspaceRoot(path.join(base, "pnpm/p"))).toBe(path.join(base, "pnpm"));
        expect(findWorkspaceRoot(path.join(base, "lerna/p"))).toBe(path.join(base, "lerna"));
    });

    it("ignores a package.json with an empty workspaces value and one that is not JSON", () => {
        write("package.json", "{ not json");
        write("one/package.json", JSON.stringify({ workspaces: false }));
        write("one/two/package.json", "{}");
        expect(findWorkspaceRoot(path.join(base, "one/two"))).toBe(path.join(base, "one/two"));
    });

    it("returns the start folder when there is no package.json at all", () => {
        write("x/y/.keep", "");
        expect(findWorkspaceRoot(path.join(base, "x/y"))).toBe(path.join(base, "x/y"));
    });

    it("agrees with Vite's searchForWorkspaceRoot on the same layouts", () => {
        write("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
        write("packages/p/package.json", "{}");
        write("solo/package.json", "{}");
        write("solo/src/.keep", "");
        for (const start of ["packages/p", "solo/src"]) {
            expect(findWorkspaceRoot(path.join(base, start))).toBe(searchForWorkspaceRoot(path.join(base, start)));
        }
    });
});
