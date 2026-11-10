import { describe, expect, it } from "vitest";
import type { Manifest } from "../config/types.js";
import { checkManifestDescription } from "./meta-checks.js";

const manifest = (name: string, description?: string): Manifest => ({
    id: "x",
    name,
    version: "1.0.0",
    ...(description !== undefined && { description }),
});

describe("checkManifestDescription", () => {
    it("flags a description that starts with the plugin name", () => {
        expect(checkManifestDescription(manifest("Snipsy", "Snipsy is a snippet manager."))).toEqual([
            {
                check: "meta",
                file: "manifest.json",
                line: 1,
                rule: "manifest-description-no-name-prefix",
                message: 'The description must not start with the plugin name. Current: "Snipsy is a snippet manager."',
            },
        ]);
    });

    it("ignores case and leading whitespace", () => {
        expect(checkManifestDescription(manifest("Dashy", "  dashy: dashboards"))).toHaveLength(1);
    });

    it("lets a description that only mentions the name later pass", () => {
        expect(checkManifestDescription(manifest("Dashy", "Dashboards for Obsidian, by Dashy."))).toEqual([]);
    });

    it("does not match a longer word that starts with the name", () => {
        expect(checkManifestDescription(manifest("Dash", "Dashboards in your vault."))).toEqual([]);
    });

    it("reads the name from the manifest, not from a list of plugins", () => {
        expect(checkManifestDescription(manifest("Garmy", "Snipsy is a snippet manager."))).toEqual([]);
        expect(checkManifestDescription(manifest("Garmy", "Garmy syncs Garmin data."))).toHaveLength(1);
    });

    it("treats characters of the name that mean something in a regular expression literally", () => {
        expect(checkManifestDescription(manifest("C++ (Notes)", "C++ (Notes) helps."))).toHaveLength(1);
        expect(checkManifestDescription(manifest("A.B", "AxB is something else."))).toEqual([]);
        expect(checkManifestDescription(manifest("A.B", "A.B is something."))).toHaveLength(1);
    });

    it("passes when there is no description", () => {
        expect(checkManifestDescription(manifest("Snipsy"))).toEqual([]);
    });

    it("quotes at most 80 characters of a long description", () => {
        const [finding] = checkManifestDescription(manifest("Snipsy", `Snipsy ${"x".repeat(200)}`));
        expect(finding?.message).toContain(JSON.stringify(`Snipsy ${"x".repeat(73)}`));
        expect(finding?.message).not.toContain("x".repeat(74));
    });
});
