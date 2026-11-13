import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { createRunNpm, fetchText } from "./runners.js";

vi.setConfig({ testTimeout: 60_000 });

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function tempPlugin(): string {
    const dir = mkdtempSync(path.join(testTmpRoot(), "opdk-kit-runners-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { ok: "node -e 0" } }));
    return dir;
}

async function serve(status: number, body: string): Promise<string> {
    const server = createServer((_request, response) => {
        response.statusCode = status;
        response.end(body);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("the test server has no port");
    }
    return `http://127.0.0.1:${String(address.port)}/CHANGELOG.md`;
}

describe("createRunNpm", () => {
    it("resolves when npm succeeds and rejects with the tail of npm's output when it fails", async () => {
        const run = createRunNpm(tempPlugin());
        await expect(run(["run", "ok", "--silent"])).resolves.toBeUndefined();
        await expect(run(["run", "no-such-script"])).rejects.toThrow(/npm run no-such-script failed:.*no-such-script/s);
    });

    it("stops npm that runs past the timeout and says so", async () => {
        const dir = tempPlugin();
        // A script file, not inline code: npm runs scripts through `sh`, and dash on Linux rejects the parentheses.
        writeFileSync(path.join(dir, "slow.cjs"), "setTimeout(() => undefined, 3000);\n");
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { slow: "node slow.cjs" } }));
        await expect(createRunNpm(dir, "npm", 300)(["run", "slow"])).rejects.toThrow("npm run slow did not finish in 0.3 seconds and was stopped.");
    });

    it("says npm is missing when it cannot start", async () => {
        await expect(createRunNpm(tempPlugin(), "opdk-no-such-npm")(["install"])).rejects.toThrow("opdk-no-such-npm is not installed or not on PATH.");
    });
});

describe("fetchText", () => {
    it("returns the body, and rejects on an error status", async () => {
        expect(await fetchText(await serve(200, "# Changelog\n"))).toBe("# Changelog\n");
        await expect(fetchText(await serve(404, "no"))).rejects.toThrow(/answered 404/);
    });

    it("cuts a body longer than the limit and says so, and leaves one at the limit whole", async () => {
        const url = await serve(200, `${"a".repeat(100)}${"b".repeat(900)}`);
        const cut = await fetchText(url, 100);
        expect(cut.split("\n")[0]).toBe("a".repeat(100));
        expect(cut).toContain("is longer than 100 bytes; the rest was not read");
        expect(await fetchText(url, 1000)).toBe(`${"a".repeat(100)}${"b".repeat(900)}`);
        const oneOver = await fetchText(url, 999);
        expect(oneOver).toContain("is longer than 999 bytes; the rest was not read");
    });

    it("returns an empty body as empty text", async () => {
        expect(await fetchText(await serve(200, ""))).toBe("");
    });
});
