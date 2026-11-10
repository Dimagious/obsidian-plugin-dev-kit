import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTrust, isReady, readinessState, readRunningVersion, resizeMainWindow } from "./page-scripts.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("applyTrust", () => {
    it("sets the trust key to the string true", () => {
        const setItem = vi.fn();
        vi.stubGlobal("localStorage", { setItem });
        applyTrust("enable-plugin-abc");
        expect(setItem).toHaveBeenCalledWith("enable-plugin-abc", "true");
    });

    it("does nothing where there is no localStorage", () => {
        vi.stubGlobal("localStorage", undefined);
        expect(() => {
            applyTrust("k");
        }).not.toThrow();
    });
});

describe("isReady and readinessState", () => {
    const stubApp = (
        layoutReady: boolean,
        plugins: Record<string, unknown> | undefined,
        loadingPluginId?: string | null,
    ): void => {
        vi.stubGlobal("app", { workspace: { layoutReady }, plugins: { plugins, loadingPluginId } });
    };

    it("is ready when the layout is ready and every plugin is loaded", () => {
        stubApp(true, { a: {}, b: {} }, null);
        expect(isReady(["a", "b"])).toBe(true);
        expect(readinessState(["a", "b"])).toEqual({ hasApp: true, layoutReady: true, missing: [], loading: [] });
    });

    it("is ready when the app does not expose loadingPluginId at all", () => {
        stubApp(true, { a: {} });
        expect(isReady(["a"])).toBe(true);
    });

    it("is not ready while plugins[id] exists but its onload() is still running", () => {
        // Obsidian sets plugins[id] first, then awaits onload() with loadingPluginId set to the id.
        stubApp(true, { a: {}, b: {} }, "b");
        expect(isReady(["a", "b"])).toBe(false);
        expect(readinessState(["a", "b"])).toEqual({ hasApp: true, layoutReady: true, missing: [], loading: ["b"] });
    });

    it("is ready again once loadingPluginId is cleared", () => {
        stubApp(true, { a: {}, b: {} }, "b");
        expect(isReady(["a", "b"])).toBe(false);
        stubApp(true, { a: {}, b: {} }, null);
        expect(isReady(["a", "b"])).toBe(true);
    });

    it("ignores a loadingPluginId that belongs to a plugin we are not waiting for", () => {
        stubApp(true, { a: {} }, "other");
        expect(isReady(["a"])).toBe(true);
    });

    it("reports a plugin that is loading before it is registered as loading, not missing", () => {
        stubApp(true, {}, "a");
        expect(isReady(["a"])).toBe(false);
        expect(readinessState(["a"])).toMatchObject({ missing: [], loading: ["a"] });
    });

    it("is not ready while the layout is", () => {
        stubApp(false, { a: {} });
        expect(isReady(["a"])).toBe(false);
        expect(readinessState(["a"]).layoutReady).toBe(false);
    });

    it("is not ready while one plugin is missing, and names it", () => {
        stubApp(true, { a: {} });
        expect(isReady(["a", "b"])).toBe(false);
        expect(readinessState(["a", "b"]).missing).toEqual(["b"]);
    });

    it("is not ready before the plugin manager exists", () => {
        stubApp(true, undefined);
        expect(isReady(["a"])).toBe(false);
        expect(readinessState(["a"])).toEqual({ hasApp: true, layoutReady: true, missing: ["a"], loading: [] });
    });

    it("is not ready, and has no app, before Obsidian defines it", () => {
        vi.stubGlobal("app", undefined);
        expect(isReady(["a"])).toBe(false);
        expect(readinessState(["a"])).toEqual({ hasApp: false, layoutReady: false, missing: ["a"], loading: [] });
    });

    it("is ready with no plugins once the layout is", () => {
        stubApp(true, {});
        expect(isReady([])).toBe(true);
    });

    it("isReady and readinessState agree on every combination", () => {
        for (const layout of [true, false]) {
            for (const plugins of [undefined, {}, { a: {} }]) {
                for (const loadingId of [undefined, null, "a"]) {
                    stubApp(layout, plugins, loadingId);
                    const state = readinessState(["a"]);
                    const expected = layout && plugins !== undefined && state.missing.length === 0 && state.loading.length === 0;
                    expect(isReady(["a"])).toBe(expected);
                }
            }
        }
    });
});

describe("readRunningVersion", () => {
    it("asks Obsidian's shell over ipc", () => {
        const sendSync = vi.fn(() => "1.14.5");
        vi.stubGlobal("require", (id: string) => (id === "electron" ? { ipcRenderer: { sendSync } } : undefined));
        expect(readRunningVersion()).toBe("1.14.5");
        expect(sendSync).toHaveBeenCalledWith("version");
    });

    it("is null when the answer is not a string or there is no ipc", () => {
        vi.stubGlobal("require", () => ({ ipcRenderer: { sendSync: () => 5 } }));
        expect(readRunningVersion()).toBeNull();
        vi.stubGlobal("require", () => ({}));
        expect(readRunningVersion()).toBeNull();
        vi.stubGlobal("require", undefined);
        expect(readRunningVersion()).toBeNull();
    });
});

describe("resizeMainWindow", () => {
    it("sizes and centres the first window", () => {
        const setSize = vi.fn();
        const center = vi.fn();
        resizeMainWindow({ BrowserWindow: { getAllWindows: () => [{ setSize, center }] } }, { width: 1200, height: 800 });
        expect(setSize).toHaveBeenCalledWith(1200, 800);
        expect(center).toHaveBeenCalled();
    });

    it("does nothing when there is no window", () => {
        expect(() => {
            resizeMainWindow({ BrowserWindow: { getAllWindows: () => [] } }, { width: 1, height: 1 });
        }).not.toThrow();
    });
});
