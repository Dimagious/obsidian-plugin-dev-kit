import { describe, expect, it, vi } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { builtinCommands } from "./commands.js";
import { createRegistry } from "./registry.js";
import { runCli } from "./run.js";

const loaded = vi.hoisted(() => ({ obsidianmd: false }));
vi.mock("eslint-plugin-obsidianmd", () => {
    loaded.obsidianmd = true;
    return { default: {} };
});

describe("builtinCommands", () => {
    it("forms a valid registry (names well-formed and unique)", () => {
        expect(() => createRegistry(builtinCommands)).not.toThrow();
    });

    it("lists build, build-css, assert-bundle, scan and demo in `opdk --help`", async () => {
        const ctx = createContext("/plugin");
        const code = await runCli(["--help"], {
            registry: createRegistry(builtinCommands),
            version: "0.0.0",
            ctx,
        });
        expect(code).toBe(0);
        const help = ctx.out.join("");
        for (const name of ["build", "build-css", "assert-bundle", "scan", "demo"]) {
            expect(help).toMatch(new RegExp(`^\\s+${name}\\s`, "m"));
        }
    });

    it("does not load the scanner's lint stack, so every other command stays fast and manifest-independent", () => {
        // builtinCommands is imported above; the scan loads ESLint and obsidianmd only when it runs.
        expect(builtinCommands.some((command) => command.name === "scan")).toBe(true);
        expect(loaded.obsidianmd).toBe(false);
    });
});
