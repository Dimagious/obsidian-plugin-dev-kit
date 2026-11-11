import { describe, expect, it } from "vitest";
import { assertCaptureAllowed, forbiddenMessage, mergeSelectors } from "./privacy.js";

const base = { seedVault: "/home/me/plugin/e2e/vault", cwd: "/home/me/plugin", action: 'film "tour"' };

describe("assertCaptureAllowed", () => {
    it("allows the plugin's own seed vault", () => {
        expect(() => { assertCaptureAllowed({ ...base, source: "option", allowForeignVault: undefined }); }).not.toThrow();
    });

    it("refuses a vault from OPDK_E2E_VAULT, naming the action, the vault and both ways out", () => {
        expect(() => { assertCaptureAllowed({ ...base, source: "env", allowForeignVault: undefined }); }).toThrow(
            /film "tour" refused: OPDK_E2E_VAULT points this run at \/home\/me\/plugin\/e2e\/vault.*Unset OPDK_E2E_VAULT.*allowForeignVault: true/s,
        );
        expect(() => { assertCaptureAllowed({ ...base, source: "env", allowForeignVault: false }); }).toThrow(/refused/);
    });

    it("allows a foreign vault when the spec says so", () => {
        expect(() => { assertCaptureAllowed({ ...base, source: "env", allowForeignVault: true }); }).not.toThrow();
    });

    it("refuses a seed vault outside the plugin folder even when it is the option, naming both folders", () => {
        const outside = { ...base, source: "option" as const, seedVault: "/home/me/notes/vault" };
        expect(() => { assertCaptureAllowed({ ...outside, allowForeignVault: undefined }); }).toThrow(
            /film "tour" refused: the seed vault \/home\/me\/notes\/vault lies outside the plugin folder \/home\/me\/plugin.*allowForeignVault: true/s,
        );
        expect(() => { assertCaptureAllowed({ ...outside, seedVault: "/home/me/plugin-other/vault", allowForeignVault: false }); }).toThrow(/lies outside/);
        expect(() => { assertCaptureAllowed({ ...outside, seedVault: "/home/me", allowForeignVault: undefined }); }).toThrow(/lies outside/);
        expect(() => { assertCaptureAllowed({ ...outside, allowForeignVault: true }); }).not.toThrow();
    });

    it("allows a vault inside the plugin folder, however deep, and the folder itself", () => {
        for (const seedVault of ["/home/me/plugin/vault", "/home/me/plugin/a/b/c", "/home/me/plugin", "/home/me/plugin/..vault"]) {
            expect(() => { assertCaptureAllowed({ ...base, source: "option", seedVault, allowForeignVault: undefined }); }).not.toThrow();
        }
    });
});

describe("forbidden selectors", () => {
    it("merges the configured and the per-call selectors once each, in order", () => {
        expect(mergeSelectors([".a", ".b"], [".b", ".c"])).toEqual([".a", ".b", ".c"]);
        expect(mergeSelectors([".a"], undefined)).toEqual([".a"]);
        expect(mergeSelectors([], [])).toEqual([]);
    });

    it("the message names the action and the selector", () => {
        expect(forbiddenMessage(".private", 'still "x"')).toMatch(/still "x" refused: .*forbidden selector "\.private" is visible/);
    });
});
