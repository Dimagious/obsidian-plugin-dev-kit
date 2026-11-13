import { describe, expect, it } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { kitCommand, kitCommands } from "./commands.js";

describe("registration", () => {
    it("exposes kit", () => {
        expect(kitCommands.map((command) => command.name)).toEqual(["kit"]);
    });

    it("documents the three pins, the tag lookup, the safeguards and the dry run", () => {
        const usage = kitCommand.usage.replace(/\s+/g, " ");
        for (const word of ["opdk kit upgrade [vX.Y.Z] [--dry-run]", "package.json", "lockfile", "uses:", "git ls-remote --tags", "npm install", "put back", "CHANGELOG", "never commits or pushes", "Dependabot", "--dry-run", "clean", "opdk release check"]) {
            expect(usage, word).toContain(word);
        }
    });
});

describe("opdk kit", () => {
    it("needs the upgrade subcommand", async () => {
        const ctx = createContext("/nonexistent");
        await expect(kitCommand.run([], ctx)).rejects.toThrow(/needs "upgrade"/);
        await expect(kitCommand.run(["downgrade"], ctx)).rejects.toThrow(/needs "upgrade"/);
    });

    it("rejects bad upgrade arguments before touching anything", async () => {
        const ctx = createContext("/nonexistent");
        await expect(kitCommand.run(["upgrade", "latest"], ctx)).rejects.toThrow(/not a kit release tag/);
    });

    it("fails with the fix when the folder has no package.json", async () => {
        const ctx = createContext("/nonexistent");
        expect(await kitCommand.run(["upgrade", "--dry-run"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("package.json is missing in /nonexistent.");
    });
});
