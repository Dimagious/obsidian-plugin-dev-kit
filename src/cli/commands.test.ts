import { describe, expect, it } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { builtinCommands } from "./commands.js";
import { createRegistry } from "./registry.js";
import { runCli } from "./run.js";

describe("builtinCommands", () => {
    it("forms a valid registry (names well-formed and unique)", () => {
        expect(() => createRegistry(builtinCommands)).not.toThrow();
    });

    it("lists build, build-css and assert-bundle in `opdk --help`", async () => {
        const ctx = createContext("/plugin");
        const code = await runCli(["--help"], {
            registry: createRegistry(builtinCommands),
            version: "0.0.0",
            ctx,
        });
        expect(code).toBe(0);
        const help = ctx.out.join("");
        for (const name of ["build", "build-css", "assert-bundle"]) {
            expect(help).toMatch(new RegExp(`^\\s+${name}\\s`, "m"));
        }
    });
});
