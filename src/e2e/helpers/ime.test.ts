import { describe, expect, it } from "vitest";
import { planComposition } from "./ime.js";

describe("planComposition", () => {
    it("word mode composes each word letter by letter and commits it with its trailing space", () => {
        expect(planComposition("be right", "word")).toEqual([
            { progress: ["b", "be"], commit: "be " },
            { progress: ["r", "ri", "rig", "righ", "right"], commit: "right" },
        ]);
    });

    it("character mode makes every character its own composition, spaces included", () => {
        expect(planComposition("a b", "character")).toEqual([
            { progress: ["a"], commit: "a" },
            { progress: [" "], commit: " " },
            { progress: ["b"], commit: "b" },
        ]);
    });

    it("commits a line break together with the word before it", () => {
        expect(planComposition("a\n\nb", "word")).toEqual([
            { progress: ["a"], commit: "a\n\n" },
            { progress: ["b"], commit: "b" },
        ]);
    });

    it("composes whitespace that stands alone (here at the start), growing like any other chunk", () => {
        expect(planComposition("  x", "word")).toEqual([
            { progress: [" ", "  "], commit: "  " },
            { progress: ["x"], commit: "x" },
        ]);
    });

    it("never splits a character outside the BMP", () => {
        const steps = planComposition("a😀", "character");
        expect(steps.map((step) => step.commit)).toEqual(["a", "😀"]);
        const word = planComposition("😀😀", "word");
        expect(word[0]?.progress).toEqual(["😀", "😀😀"]);
    });

    it("handles non-Latin text: the commit joined back is the input", () => {
        const text = "привет мир 你好";
        for (const chunking of ["word", "character"] as const) {
            expect(planComposition(text, chunking).map((step) => step.commit).join("")).toBe(text);
        }
    });

    it("plans nothing for an empty string", () => {
        expect(planComposition("", "word")).toEqual([]);
        expect(planComposition("", "character")).toEqual([]);
    });
});
