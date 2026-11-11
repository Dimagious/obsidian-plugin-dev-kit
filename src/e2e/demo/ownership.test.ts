import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testTmpRoot } from "../../test-support/test-tmp.js";
import { assertFilmFree, assertNotOwnedByAnotherTest, assertStillFree, parseOwner, serializeOwner, writeFilmOwner, writeStillOwner, type Owner } from "./ownership.js";

const mine: Owner = { testId: "a", runId: "r1", title: "My test" };

describe("parseOwner", () => {
    it("reads what serializeOwner wrote", () => {
        expect(parseOwner(serializeOwner(mine))).toEqual(mine);
    });

    it.each(["{", "[]", "null", '{"testId":"a"}', '{"testId":1,"runId":"r","title":"t"}'])("gives null for %s", (text) => {
        expect(parseOwner(text)).toBeNull();
    });
});

describe("assertNotOwnedByAnotherTest", () => {
    it("passes without a marker, for the same test, and for an earlier run", () => {
        expect(() => { assertNotOwnedByAnotherTest(null, mine, "film"); }).not.toThrow();
        expect(() => { assertNotOwnedByAnotherTest(mine, mine, "film"); }).not.toThrow();
        expect(() => { assertNotOwnedByAnotherTest({ ...mine, testId: "b", runId: "r0" }, mine, "film"); }).not.toThrow();
    });

    it("fails for another test of the same run, naming it", () => {
        expect(() => { assertNotOwnedByAnotherTest({ testId: "b", runId: "r1", title: "Their test" }, mine, 'film "x"'); }).toThrow(
            /film "x" was already written in this run by another test \("Their test"\)/,
        );
    });
});

describe("markers on disk", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-e2e-owner-test-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("a film folder without a marker (or without the folder) is free", () => {
        expect(() => { assertFilmFree(path.join(root, "nope"), mine, "film"); }).not.toThrow();
        fs.mkdirSync(path.join(root, "films"));
        expect(() => { assertFilmFree(path.join(root, "films"), mine, "film"); }).not.toThrow();
    });

    it("a film marker of another test blocks, one of this test does not", () => {
        writeFilmOwner(root, { ...mine, testId: "b" });
        expect(() => { assertFilmFree(root, mine, "film"); }).toThrow(/another test/);
        writeFilmOwner(root, mine);
        expect(() => { assertFilmFree(root, mine, "film"); }).not.toThrow();
    });

    it("a still marker lives under .owners/stills, outside the pictures folder, and is per name", () => {
        writeStillOwner(root, "hero", { ...mine, testId: "b" });
        expect(fs.existsSync(path.join(root, ".owners", "stills", "hero.json"))).toBe(true);
        expect(() => { assertStillFree(root, "hero", mine, "still"); }).toThrow(/another test/);
        expect(() => { assertStillFree(root, "other", mine, "still"); }).not.toThrow();
    });

    it("a marker that cannot be read for another reason than being absent is an error, not a free name", () => {
        fs.mkdirSync(path.join(root, "owner.json"));
        expect(() => { assertFilmFree(root, mine, "film"); }).toThrow();
    });
});
