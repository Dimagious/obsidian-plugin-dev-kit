import type { CDPSession } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { createDeviceMetricsTracker } from "./device-metrics.js";
import type { DeviceMetrics } from "./mobile.js";

const PHONE: DeviceMetrics = { width: 390, height: 844, deviceScaleFactor: 2, mobile: false };

function setUp(failOn?: { method: string; times: number }): { sent: { method: string; params: unknown }[]; tracker: ReturnType<typeof createDeviceMetricsTracker> } {
    const sent: { method: string; params: unknown }[] = [];
    let failures = 0;
    const session = {
        send: (method: string, params?: unknown): Promise<unknown> => {
            if (failOn?.method === method && failures < failOn.times) {
                failures += 1;
                return Promise.reject(new Error(`${method} failed`));
            }
            sent.push({ method, params });
            return Promise.resolve({});
        },
    } as unknown as CDPSession;
    return { sent, tracker: createDeviceMetricsTracker(() => Promise.resolve(session)) };
}

const methods = (sent: { method: string }[]): string[] => sent.map((command) => command.method.replace("Emulation.", ""));

describe("device metrics tracker", () => {
    it("sets a new override without a clear and remembers it", async () => {
        const { sent, tracker } = setUp();
        expect(tracker.last()).toBeUndefined();
        await tracker.set(PHONE);
        expect(sent).toEqual([{ method: "Emulation.setDeviceMetricsOverride", params: PHONE }]);
        expect(tracker.last()).toEqual(PHONE);
    });

    it("sends set, clear, set when the same override is sent again (a screenshot dropped it from the page)", async () => {
        const { sent, tracker } = setUp();
        await tracker.set(PHONE);
        await tracker.set(PHONE);
        expect(methods(sent)).toEqual(["setDeviceMetricsOverride", "clearDeviceMetricsOverride", "setDeviceMetricsOverride"]);
        expect(tracker.last()).toEqual(PHONE);
    });

    it.each([
        ["width", { ...PHONE, width: 391 }],
        ["height", { ...PHONE, height: 845 }],
        ["scale", { ...PHONE, deviceScaleFactor: 3 }],
    ])("sends no clear when only the %s differs", async (_name, other) => {
        const { sent, tracker } = setUp();
        await tracker.set(PHONE);
        await tracker.set(other);
        expect(methods(sent)).toEqual(["setDeviceMetricsOverride", "setDeviceMetricsOverride"]);
        expect(tracker.last()).toEqual(other);
    });

    it("forgets on clear, so a later identical set has no clear", async () => {
        const { sent, tracker } = setUp();
        await tracker.set(PHONE);
        await tracker.clear();
        expect(tracker.last()).toBeUndefined();
        await tracker.set(PHONE);
        expect(methods(sent)).toEqual(["setDeviceMetricsOverride", "clearDeviceMetricsOverride", "setDeviceMetricsOverride"]);
        expect(sent.filter((command) => command.method === "Emulation.clearDeviceMetricsOverride")).toHaveLength(1);
    });

    it("remembers nothing when the set fails, and says why", async () => {
        const { tracker } = setUp({ method: "Emulation.setDeviceMetricsOverride", times: 1 });
        await expect(tracker.set(PHONE)).rejects.toThrow("Emulation.setDeviceMetricsOverride failed");
        expect(tracker.last()).toBeUndefined();
    });

    it("forgets the old override when the clear before a repeated set succeeds and the set then fails", async () => {
        const { sent, tracker } = setUp();
        await tracker.set(PHONE);
        const failing = createDeviceMetricsTracker(() =>
            Promise.resolve({
                send: (method: string) => (method === "Emulation.setDeviceMetricsOverride" ? Promise.reject(new Error("closed")) : Promise.resolve({})),
            } as unknown as CDPSession),
        );
        expect(sent).toHaveLength(1);
        await expect(failing.set(PHONE)).rejects.toThrow("closed");
        expect(failing.last()).toBeUndefined();
    });

    it("keeps the override when the clear fails", async () => {
        const { tracker } = setUp({ method: "Emulation.clearDeviceMetricsOverride", times: 1 });
        await tracker.set(PHONE);
        await expect(tracker.clear()).rejects.toThrow("Emulation.clearDeviceMetricsOverride failed");
        expect(tracker.last()).toEqual(PHONE);
    });
});
