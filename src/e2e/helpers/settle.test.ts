import { describe, expect, it } from "vitest";
import { DEFAULT_SETTLE_QUIET_MS, resolveSettleOptions, settleRootMissingMessage, settleTimeoutMessage } from "./settle.js";

describe("resolveSettleOptions", () => {
    it("defaults to 150 ms over the whole body", () => {
        expect(DEFAULT_SETTLE_QUIET_MS).toBe(150);
        expect(resolveSettleOptions({}, 10_000)).toEqual({ quietMs: 150, root: null });
    });

    it("takes quietMs and root as given, and allows a quietMs of 0", () => {
        expect(resolveSettleOptions({ quietMs: 0, root: ".workspace" }, 10_000)).toEqual({ quietMs: 0, root: ".workspace" });
        expect(resolveSettleOptions({ quietMs: 9_999 }, 10_000).quietMs).toBe(9_999);
    });

    it("rejects a quietMs that is negative, not a number, or not below the budget", () => {
        expect(() => resolveSettleOptions({ quietMs: -5 }, 10_000)).toThrow("quietMs must be a number of milliseconds from 0, got -5");
        expect(() => resolveSettleOptions({ quietMs: Number.NaN }, 10_000)).toThrow("got NaN");
        expect(() => resolveSettleOptions({ quietMs: 10_000 }, 10_000)).toThrow("not below the wait budget timeouts.helpers.ui (10000 ms)");
    });

    it("rejects an empty or non-string root", () => {
        expect(() => resolveSettleOptions({ root: "" }, 10_000)).toThrow('root must be a non-empty CSS selector, got ""');
        expect(() => resolveSettleOptions({ root: 3 as never }, 10_000)).toThrow("got 3");
    });
});

describe("messages", () => {
    it("names settle(), the budget, the reasons and the three ways out", () => {
        const message = settleTimeoutMessage({ budgetMs: 10_000, quietMs: 150, root: null, reasons: ["the DOM changed 5 ms ago", "a font is still loading"] });
        expect(message).toBe(
            "settle(): the page was not quiet for 150 ms within 10000 ms (the DOM changed 5 ms ago; a font is still loading). " +
                "Raise timeouts.helpers.ui if the app is slow, pass root to watch only the part that matters (something elsewhere keeps changing), or lower quietMs.",
        );
    });

    it("names the root, and copes with a page that settled right after the budget", () => {
        const message = settleTimeoutMessage({ budgetMs: 1000, quietMs: 50, root: ".view", reasons: [] });
        expect(message).toContain('".view" was not quiet');
        expect(message).toContain("it settled just after the budget ran out");
    });

    it("says which root matched nothing", () => {
        expect(settleRootMissingMessage(".x")).toContain('nothing matches root ".x"');
    });
});
