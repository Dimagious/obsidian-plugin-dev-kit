import { describe, expect, it } from "vitest";
import { assertName, defaultNameText, resolveName, slugify } from "./names.js";

describe("slugify", () => {
    it("lower-cases a test title and turns runs of other characters into one dash", () => {
        expect(slugify("Wizard film: pick sports & go!")).toBe("wizard-film-pick-sports-go");
    });

    it("trims dashes and caps the length without leaving a trailing dash", () => {
        expect(slugify("  --Hello--  ")).toBe("hello");
        const long = slugify(`${"a".repeat(99)} b`);
        expect(long).toBe("a".repeat(99));
        expect(slugify("x".repeat(300))).toHaveLength(100);
    });

    it("gives an empty string when nothing usable is left", () => {
        expect(slugify("!!! ???")).toBe("");
    });
});

describe("assertName", () => {
    it("accepts one safe path segment", () => {
        expect(assertName("wizard_v2.1-light", "film")).toBe("wizard_v2.1-light");
    });

    it.each(["", ".hidden", "-lead", "a/b", "a\\b", "..", "../x", "a b", "é", "x".repeat(101)])("refuses %j", (name) => {
        expect(() => assertName(name, "film")).toThrow(/film name .* is not usable as a file name/);
    });
});

describe("resolveName", () => {
    it("uses the given name, the test title otherwise, and adds the theme", () => {
        expect(resolveName("tour", "Some test", null, "film")).toBe("tour");
        expect(resolveName(undefined, "Some Test!", null, "film")).toBe("some-test");
        expect(resolveName("tour", "t", "dark", "film")).toBe("tour-dark");
        expect(resolveName(undefined, "Some Test", "light", "still")).toBe("some-test-light");
    });

    it("fails when the title gives no name, telling to pass one", () => {
        expect(() => resolveName(undefined, "???", null, "film")).toThrow(/gives no usable film name. Pass a name/);
    });

    it("fails on a given name that is not safe", () => {
        expect(() => resolveName("../escape", "t", null, "still")).toThrow(/still name/);
    });
});

describe("defaultNameText", () => {
    const titlePath = ["e2e/tour.spec.ts", "phone tour", "light", "opens the wizard"];

    it("joins the describe titles and the test title, without the file", () => {
        expect(defaultNameText({ titlePath, project: "obsidian", projectCount: 1 })).toBe("phone tour light opens the wizard");
        expect(defaultNameText({ titlePath: ["f.spec.ts", "plain test"], project: "obsidian", projectCount: 1 })).toBe("plain test");
    });

    it("adds the project when the config has several, so one test in two projects gets two folders", () => {
        const a = defaultNameText({ titlePath, project: "desktop", projectCount: 2 });
        const b = defaultNameText({ titlePath, project: "phone", projectCount: 2 });
        expect(a).toBe("phone tour light opens the wizard desktop");
        expect(slugify(a)).not.toBe(slugify(b));
    });

    it("tells two tests with the same title under different describe blocks apart", () => {
        const one = defaultNameText({ titlePath: ["f.spec.ts", "light", "opens"], project: "p", projectCount: 1 });
        const two = defaultNameText({ titlePath: ["f.spec.ts", "dark", "opens"], project: "p", projectCount: 1 });
        expect(slugify(one)).toBe("light-opens");
        expect(slugify(two)).toBe("dark-opens");
    });
});
