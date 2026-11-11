import type { CDPSession } from "@playwright/test";
import type { DeviceMetrics } from "./mobile.js";

/**
 * The device metrics override of the window's one CDP session, and what that session last sent. `mobile()`, `desktop()`
 * and the demo's shots all go through it, so they agree on what the session counts as active.
 */
export interface DeviceMetricsTracker {
    /**
     * Sets the override. Sends `Emulation.clearDeviceMetricsOverride` first when `metrics` equal the last override this
     * session sent: Playwright's own `page.screenshot()` drops the override from the page (Chromium captures beyond the
     * viewport), but the session still counts it as active, and Chromium ignores a set that repeats it.
     */
    set(metrics: DeviceMetrics): Promise<void>;
    /** Clears the override and forgets it. */
    clear(): Promise<void>;
    /** The last override this session sent and did not clear, or undefined when there is none. */
    last(): DeviceMetrics | undefined;
}

/** `mobile` is always false in `DeviceMetrics`, so it is not compared. */
export function isSameMetrics(a: DeviceMetrics, b: DeviceMetrics): boolean {
    return a.width === b.width && a.height === b.height && a.deviceScaleFactor === b.deviceScaleFactor;
}

export function createDeviceMetricsTracker(getSession: () => Promise<CDPSession>): DeviceMetricsTracker {
    let last: DeviceMetrics | undefined;
    return {
        set: async (metrics) => {
            const session = await getSession();
            if (last !== undefined && isSameMetrics(last, metrics)) {
                await session.send("Emulation.clearDeviceMetricsOverride");
                // Cleared, so a failing set below leaves nothing remembered.
                last = undefined;
            }
            await session.send("Emulation.setDeviceMetricsOverride", { ...metrics });
            last = metrics;
        },
        clear: async () => {
            const session = await getSession();
            await session.send("Emulation.clearDeviceMetricsOverride");
            last = undefined;
        },
        last: () => last,
    };
}
