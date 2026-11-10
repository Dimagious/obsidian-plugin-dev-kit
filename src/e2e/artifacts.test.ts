import { describe, expect, it } from "vitest";
import { parseTraceSetting, parseVideoSetting, shouldKeep, shouldRecord, type ArtifactMode } from "./artifacts.js";

// Every mode against retry 0 (first run), 1 (first retry) and 2 (second retry): [record0, record1, record2].
const RECORD: Record<ArtifactMode, [boolean, boolean, boolean]> = {
    off: [false, false, false],
    on: [true, true, true],
    "retain-on-failure": [true, true, true],
    "on-first-retry": [false, true, false],
    "on-all-retries": [false, true, true],
    "retain-on-first-failure": [true, false, false],
    "retain-on-failure-and-retries": [true, true, true],
};

describe("shouldRecord", () => {
    for (const [mode, expected] of Object.entries(RECORD) as [ArtifactMode, [boolean, boolean, boolean]][]) {
        it(`${mode}: first run, first retry, second retry`, () => {
            expect([0, 1, 2].map((retry) => shouldRecord(mode, retry))).toEqual(expected);
        });
    }
});

describe("shouldKeep", () => {
    it("off keeps nothing, failed or not", () => {
        expect([shouldKeep("off", true, 0), shouldKeep("off", false, 1)]).toEqual([false, false]);
    });

    it("on keeps everything", () => {
        expect([shouldKeep("on", false, 0), shouldKeep("on", true, 0), shouldKeep("on", false, 3)]).toEqual([true, true, true]);
    });

    it("retain-on-failure keeps only failed runs, on every attempt", () => {
        expect([shouldKeep("retain-on-failure", false, 0), shouldKeep("retain-on-failure", true, 0), shouldKeep("retain-on-failure", true, 2)]).toEqual(
            [false, true, true],
        );
        expect(shouldKeep("retain-on-failure", false, 2)).toBe(false);
    });

    it("retain-on-first-failure keeps a failed first run and records nothing for retries", () => {
        expect([shouldKeep("retain-on-first-failure", true, 0), shouldKeep("retain-on-first-failure", false, 0)]).toEqual([true, false]);
        expect(shouldKeep("retain-on-first-failure", true, 1)).toBe(false);
    });

    it("retain-on-failure-and-retries keeps failed runs and every retry", () => {
        expect([
            shouldKeep("retain-on-failure-and-retries", false, 0),
            shouldKeep("retain-on-failure-and-retries", true, 0),
            shouldKeep("retain-on-failure-and-retries", false, 1),
        ]).toEqual([false, true, true]);
    });

    it("on-first-retry keeps the first retry whether it passed or failed, and nothing else", () => {
        expect([
            shouldKeep("on-first-retry", false, 0),
            shouldKeep("on-first-retry", true, 0),
            shouldKeep("on-first-retry", false, 1),
            shouldKeep("on-first-retry", true, 1),
            shouldKeep("on-first-retry", true, 2),
        ]).toEqual([false, false, true, true, false]);
    });

    it("on-all-retries keeps every retry and not the first run", () => {
        expect([shouldKeep("on-all-retries", true, 0), shouldKeep("on-all-retries", false, 1), shouldKeep("on-all-retries", false, 2)]).toEqual([
            false,
            true,
            true,
        ]);
    });
});

describe("parseTraceSetting", () => {
    it("reads a mode string, with every capture on", () => {
        expect(parseTraceSetting("retain-on-failure")).toEqual({ mode: "retain-on-failure", screenshots: true, snapshots: true, sources: true });
    });

    it("treats an unset value as off", () => {
        expect(parseTraceSetting(undefined).mode).toBe("off");
    });

    it("reads the object form and honours explicit false", () => {
        expect(parseTraceSetting({ mode: "on", screenshots: false, snapshots: false, sources: false })).toEqual({
            mode: "on",
            screenshots: false,
            snapshots: false,
            sources: false,
        });
    });

    it("treats a snapshots object as on", () => {
        expect(parseTraceSetting({ mode: "on", snapshots: { dom: true } }).snapshots).toBe(true);
    });

    it("maps the deprecated retry-with-trace to on-first-retry", () => {
        expect(parseTraceSetting("retry-with-trace").mode).toBe("on-first-retry");
    });

    it("accepts retry-with-trace for the trace only, in both forms", () => {
        expect(parseTraceSetting({ mode: "retry-with-trace" }).mode).toBe("on-first-retry");
        expect(() => parseTraceSetting("retry-with-video")).toThrow("use.trace");
        expect(() => parseTraceSetting({ mode: "retry-with-video" })).toThrow("use.trace.mode");
    });

    it("names the option and the allowed values on a bad mode", () => {
        expect(() => parseTraceSetting("always")).toThrow(/use\.trace value "always".*retain-on-failure/);
        expect(() => parseTraceSetting({ mode: 3 })).toThrow("use.trace.mode");
        expect(() => parseTraceSetting({})).toThrow("use.trace.mode");
    });
});

describe("parseVideoSetting", () => {
    it("reads a mode string", () => {
        expect(parseVideoSetting("on-first-retry")).toEqual({ mode: "on-first-retry" });
    });

    it("treats an unset value as off", () => {
        expect(parseVideoSetting(undefined)).toEqual({ mode: "off" });
    });

    it("reads the object form with a size", () => {
        expect(parseVideoSetting({ mode: "on", size: { width: 640, height: 480 } })).toEqual({ mode: "on", size: { width: 640, height: 480 } });
    });

    it("ignores a malformed size", () => {
        expect(parseVideoSetting({ mode: "on", size: { width: "wide" } })).toEqual({ mode: "on" });
    });

    it("maps the deprecated retry-with-video to on-first-retry, in both forms", () => {
        expect(parseVideoSetting("retry-with-video").mode).toBe("on-first-retry");
        expect(parseVideoSetting({ mode: "retry-with-video" }).mode).toBe("on-first-retry");
    });

    it("refuses retry-with-trace, which is a trace alias only", () => {
        expect(() => parseVideoSetting("retry-with-trace")).toThrow("use.video");
        expect(() => parseVideoSetting({ mode: "retry-with-trace" })).toThrow("use.video.mode");
    });

    it("names the option on a bad mode", () => {
        expect(() => parseVideoSetting("sometimes")).toThrow(/use\.video value "sometimes"/);
        expect(() => parseVideoSetting({ mode: "x" })).toThrow("use.video.mode");
    });
});
