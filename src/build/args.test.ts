import { describe, expect, it } from "vitest";
import { parseBuildArgs } from "./args.js";

describe("parseBuildArgs", () => {
    it("defaults to a plain release build", () => {
        expect(parseBuildArgs([])).toEqual({ vault: false, watch: false, force: false });
    });

    it("reads --vault with a directory", () => {
        expect(parseBuildArgs(["--vault", "/v/p"])).toEqual({ vault: true, vaultDir: "/v/p", watch: false, force: false });
    });

    it("reads --vault=<dir>", () => {
        expect(parseBuildArgs(["--vault=/v/p"])).toEqual({ vault: true, vaultDir: "/v/p", watch: false, force: false });
    });

    it("lets --vault stand alone (the directory then comes from VAULT_PLUGIN)", () => {
        expect(parseBuildArgs(["--vault"])).toEqual({ vault: true, watch: false, force: false });
    });

    it("does not take a following flag for the directory", () => {
        expect(parseBuildArgs(["--vault", "--watch"])).toEqual({ vault: true, watch: true, force: false });
    });

    it("accepts --watch before --vault", () => {
        expect(parseBuildArgs(["--watch", "--vault", "d"])).toEqual({ vault: true, vaultDir: "d", watch: true, force: false });
    });

    it("reads --force next to --vault", () => {
        expect(parseBuildArgs(["--vault", "d", "--force"])).toEqual({ vault: true, vaultDir: "d", watch: false, force: true });
    });

    it("rejects --force without --vault", () => {
        expect(() => parseBuildArgs(["--force"])).toThrow("--force only works together with --vault");
    });

    it("rejects --watch without --vault", () => {
        expect(() => parseBuildArgs(["--watch"])).toThrow("--watch only works together with --vault");
    });

    it.each([[["--vault="]], [["--vault", ""]], [["--watch", "--vault", ""]]])("rejects an empty directory (%j)", (args) => {
        expect(() => parseBuildArgs(args)).toThrow("--vault needs a non-empty directory");
    });

    it.each([["--bogus"], ["stray"]])("rejects the unknown argument %s", (arg) => {
        expect(() => parseBuildArgs([arg])).toThrow(`Unknown argument "${arg}"`);
    });
});
