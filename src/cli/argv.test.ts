import { describe, expect, it } from "vitest";
import { parseArgv } from "./argv.js";

describe("parseArgv", () => {
    it("treats no args, --help and -h as help", () => {
        expect(parseArgv([])).toEqual({ kind: "help" });
        expect(parseArgv(["--help"])).toEqual({ kind: "help" });
        expect(parseArgv(["-h"])).toEqual({ kind: "help" });
    });

    it("recognises --version", () => {
        expect(parseArgv(["--version"])).toEqual({ kind: "version" });
    });

    it("splits a command from its args", () => {
        expect(parseArgv(["build", "--watch", "x"])).toEqual({ kind: "run", name: "build", args: ["--watch", "x"] });
    });

    it("asks for command help when --help or -h follows the command, in any position", () => {
        expect(parseArgv(["build", "--help"])).toEqual({ kind: "command-help", name: "build" });
        expect(parseArgv(["build", "--watch", "-h"])).toEqual({ kind: "command-help", name: "build" });
    });

    it("leaves help flags after a bare -- to the command", () => {
        expect(parseArgv(["build", "--", "--help"])).toEqual({ kind: "run", name: "build", args: ["--", "--help"] });
    });

    it("passes unknown flags in command position through as a command name", () => {
        expect(parseArgv(["--bogus"])).toEqual({ kind: "run", name: "--bogus", args: [] });
    });
});
