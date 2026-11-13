import { describe, expect, expectTypeOf, it } from "vitest";
import type { AppWithInternals, PartialApp, PluginInstance } from "./internals.js";

// These checks run in `npm run typecheck`: a changed shape of the types fails there. The runtime assertions only
// keep vitest from reporting an empty test.
describe("AppWithInternals", () => {
    it("types the members specs reach without any", () => {
        expectTypeOf<AppWithInternals["plugins"]["enablePlugin"]>().toEqualTypeOf<(id: string) => Promise<unknown>>();
        expectTypeOf<AppWithInternals["plugins"]["plugins"][string]>().toEqualTypeOf<PluginInstance | undefined>();
        expectTypeOf<AppWithInternals["setting"]["activeTab"]>().toEqualTypeOf<{ id: string } | null | undefined>();
        expectTypeOf<AppWithInternals["commands"]["executeCommandById"]>().toEqualTypeOf<(id: string) => boolean>();
        expectTypeOf<AppWithInternals["metadataCache"]["inProgressTaskCount"]>().toEqualTypeOf<number | undefined>();
        expectTypeOf<AppWithInternals["internalPlugins"]["plugins"][string]>().not.toBeAny();
        expect(true).toBe(true);
    });

    it("types a plugin's own members through the type parameter", () => {
        type Mine = AppWithInternals<PluginInstance & { settings?: { greeting?: string } }>;
        expectTypeOf<NonNullable<Mine["plugins"]["plugins"][string]>["settings"]>().toEqualTypeOf<{ greeting?: string } | undefined>();
        expectTypeOf<NonNullable<AppWithInternals["plugins"]["plugins"][string]>["settings"]>().toEqualTypeOf<unknown>();
        expect(true).toBe(true);
    });

    it("PartialApp makes every level optional for page scripts", () => {
        const empty: PartialApp = {};
        const deep: PartialApp = { vault: { getConfig: () => 1 }, changeTheme: () => undefined };
        expect(empty.vault?.setConfig).toBeUndefined();
        expect(deep.vault?.getConfig?.("x")).toBe(1);
    });
});
