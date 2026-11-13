import { describe, expect, it } from "vitest";
import { capProblems, DEFAULT_MAX_FOCUS_STOPS, DEFAULT_MIN_TOUCH_SIZE, DEFAULT_TOUCH_TARGETS, focusStartMessage, layoutFailureMessage, noChecksMessage, resolveLayoutOptions, rootMissingMessage, type LayoutProblem } from "./layout.js";

describe("resolveLayoutOptions: defaults", () => {
    it("checks overflow, decides touch targets from the window and leaves the focus ring off", () => {
        expect(resolveLayoutOptions({ root: ".modal" })).toEqual({
            root: ".modal",
            overflow: { enabled: true, ignore: null },
            touch: { enabled: null, minSize: DEFAULT_MIN_TOUCH_SIZE, selector: DEFAULT_TOUCH_TARGETS, ignore: null },
            focus: { enabled: false, from: null, maxStops: DEFAULT_MAX_FOCUS_STOPS, stayInside: false },
        });
        expect(DEFAULT_MIN_TOUCH_SIZE).toBe(44);
    });

    it("lets every check be turned on or off", () => {
        const resolved = resolveLayoutOptions({ root: "r", overflow: false, touchTargets: false, focusRing: true });
        expect(resolved.overflow.enabled).toBe(false);
        expect(resolved.touch.enabled).toBe(false);
        expect(resolved.focus.enabled).toBe(true);
        expect(resolveLayoutOptions({ root: "r", touchTargets: true }).touch.enabled).toBe(true);
        expect(resolveLayoutOptions({ root: "r", focusRing: false }).focus.enabled).toBe(false);
    });

    it("takes the detailed options, and an object turns the check on", () => {
        const resolved = resolveLayoutOptions({ root: "r", touchTargets: { minSize: 48, selector: ".tap", ignore: ".small-ok" }, focusRing: { from: ".first", maxStops: 5, stayInside: true } });
        expect(resolved.touch).toEqual({ enabled: true, minSize: 48, selector: ".tap", ignore: ".small-ok" });
        expect(resolved.focus).toEqual({ enabled: true, from: ".first", maxStops: 5, stayInside: true });
        expect(resolveLayoutOptions({ root: "r", overflow: { ignore: "pre" } }).overflow).toEqual({ enabled: true, ignore: "pre" });
        expect(resolveLayoutOptions({ root: "r", overflow: {} }).overflow).toEqual({ enabled: true, ignore: null });
        expect(resolveLayoutOptions({ root: "r", touchTargets: {}, focusRing: {} }).touch.enabled).toBe(true);
    });
});

describe("resolveLayoutOptions: failures say what to do", () => {
    it.each([
        [undefined, /pass an object with the root/],
        [null, /pass an object with the root/],
        ["root", /pass an object with the root/],
        [{}, /root is required/],
        [{ root: "" }, /root must be a non-empty CSS selector/],
        [{ root: 3 }, /root must be a non-empty CSS selector, got 3/],
        [{ root: "r", rot: 1 }, /unknown key\(s\) in the options: rot\. Allowed keys: root, overflow, touchTargets, focusRing\./],
        [{ root: "r", overflow: "yes" }, /overflow must be true, false or an object/],
        [{ root: "r", overflow: { skip: "pre" } }, /unknown key\(s\) in overflow: skip/],
        [{ root: "r", overflow: { ignore: "" } }, /overflow\.ignore must be a non-empty CSS selector/],
        [{ root: "r", focusRing: { stayInside: "yes" } }, /focusRing\.stayInside must be true or false/],
        [{ root: "r", touchTargets: "all" }, /touchTargets must be true, false or an object/],
        [{ root: "r", touchTargets: { size: 44 } }, /unknown key\(s\) in touchTargets: size/],
        [{ root: "r", touchTargets: { minSize: 0 } }, /minSize must be a number of CSS pixels above 0/],
        [{ root: "r", touchTargets: { minSize: "44" } }, /minSize must be a number/],
        [{ root: "r", touchTargets: { selector: "" } }, /touchTargets\.selector must be a non-empty CSS selector/],
        [{ root: "r", focusRing: 2 }, /focusRing must be true, false or an object/],
        [{ root: "r", focusRing: { maxStops: 0 } }, /maxStops must be a whole number from 1 to 100/],
        [{ root: "r", focusRing: { maxStops: 101 } }, /maxStops must be a whole number from 1 to 100/],
        [{ root: "r", focusRing: { maxStops: 2.5 } }, /maxStops must be a whole number/],
        [{ root: "r", focusRing: { from: " " } }, /focusRing\.from must be a non-empty CSS selector/],
    ])("%j", (options, message) => {
        expect(() => resolveLayoutOptions(options)).toThrow(message);
    });
});

describe("messages", () => {
    it("lists every problem on its own line, singular and plural", () => {
        const one = layoutFailureMessage(".modal", [{ check: "overflow", where: "div.modal", detail: "scrollWidth 420 > clientWidth 390" }], 44);
        expect(one).toBe('checkLayout(): 1 problem inside ".modal":\n  - horizontal overflow: div.modal (scrollWidth 420 > clientWidth 390)');
        const many = layoutFailureMessage(
            ".modal",
            [
                { check: "touch-target", where: "button.save", detail: "30 x 28 px" },
                { check: "focus-ring", where: "input.name", detail: "outline none 0px, box-shadow none" },
            ],
            48,
        );
        expect(many).toContain('2 problems inside ".modal"');
        expect(many).toContain("  - touch target too small: button.save (30 x 28 px)");
        expect(many).toContain("  - no focus ring: input.name (outline none 0px, box-shadow none)");
        expect(many).toContain("at least 48 px");
        expect(many).toContain(":focus-visible");
    });

    it("adds a hint only for the checks that failed", () => {
        const text = layoutFailureMessage("r", [{ check: "overflow", where: "div", detail: "x" }], 44);
        expect(text).not.toContain("Touch targets must");
        expect(text).not.toContain("focus-visible");
    });

    it("names the root, the start or the missing checks", () => {
        expect(rootMissingMessage(".gone")).toContain('nothing matches the root ".gone"');
        expect(focusStartMessage("no-start", ".r", null)).toContain('nothing inside ".r" can take focus');
        expect(focusStartMessage("no-start", ".r", ".first")).toContain('focusRing.from ".first" matches nothing');
        expect(focusStartMessage("outside-root", ".r", ".ribbon")).toContain('focusRing.from ".ribbon" is not inside ".r"');
        expect(focusStartMessage("not-focused", ".r", null)).toContain("did not take focus");
        expect(noChecksMessage()).toContain("nothing to check");
    });

    it("says when a kind was cut, and hints at a trap", () => {
        const problems: LayoutProblem[] = [{ check: "overflow", where: "div", detail: "x" }, { check: "focus-escape", where: "button.ribbon", detail: "Tab 3 moved focus out" }];
        const text = layoutFailureMessage("r", problems, 44, [{ check: "overflow", total: 37 }]);
        expect(text).toContain("  - horizontal overflow: (first 1 of 37)");
        expect(text).toContain("  - focus left the root: button.ribbon (Tab 3 moved focus out)");
        expect(text).toContain("Keep Tab inside a modal");
    });
});

describe("capProblems", () => {
    const many = (check: LayoutProblem["check"], count: number): LayoutProblem[] => Array.from({ length: count }, (_, index) => ({ check, where: `el${String(index)}`, detail: "d" }));

    it("keeps everything under the limit", () => {
        expect(capProblems(many("focus-ring", 3), 3)).toEqual({ problems: many("focus-ring", 3), cuts: [] });
    });

    it("cuts each kind on its own and reports the totals", () => {
        const result = capProblems([...many("focus-ring", 12), ...many("overflow", 2)], 10);
        expect(result.problems.filter((problem) => problem.check === "focus-ring")).toHaveLength(10);
        expect(result.problems.filter((problem) => problem.check === "overflow")).toHaveLength(2);
        expect(result.cuts).toEqual([{ check: "focus-ring", total: 12 }]);
    });
});
