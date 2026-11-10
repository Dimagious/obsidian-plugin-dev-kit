import { describe, expect, it } from "vitest";
import { gateSkipReason, isGateOpen } from "./gate.js";

describe("isGateOpen", () => {
    it('opens only for exactly "1"', () => {
        expect(isGateOpen({ CAPTURE: "1" }, "CAPTURE")).toBe(true);
    });

    it.each(["", "0", "true", "yes", "11", " 1"])("stays closed for %j", (value) => {
        expect(isGateOpen({ CAPTURE: value }, "CAPTURE")).toBe(false);
    });

    it("stays closed when the variable is unset or another one is set", () => {
        expect(isGateOpen({}, "CAPTURE")).toBe(false);
        expect(isGateOpen({ RECORD: "1" }, "CAPTURE")).toBe(false);
    });
});

describe("gateSkipReason", () => {
    it("tells the reader which variable to set", () => {
        expect(gateSkipReason("CAPTURE")).toBe("set CAPTURE=1 to run this spec");
    });
});
