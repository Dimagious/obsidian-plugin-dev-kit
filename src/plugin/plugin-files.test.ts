import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// The Claude Code plugin files are published as they are in the repository, so these tests read the real files.
const root = path.resolve(import.meta.dirname, "../..");
const pluginRoot = path.join(root, "plugins/opdk");
const MAX_DESCRIPTION = 1536;

function readJson(file: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed)) {
        throw new Error(`${file} is not a JSON object`);
    }
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface MarketplaceEntry {
    name: string;
    source: string;
}

function isMarketplaceEntry(value: unknown): value is MarketplaceEntry {
    return isRecord(value) && typeof value.name === "string" && typeof value.source === "string";
}

function marketplaceEntries(): MarketplaceEntry[] {
    const plugins = marketplace.plugins;
    if (!Array.isArray(plugins) || !plugins.every(isMarketplaceEntry)) {
        throw new Error("marketplace.json: `plugins` must be a list of { name, source } entries");
    }
    return plugins;
}

function frontmatterField(text: string, field: string): string | undefined {
    const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    return new RegExp(`^${field}: (.*)$`, "m").exec(block)?.[1];
}

const pkg = readJson(path.join(root, "package.json"));
const manifest = readJson(path.join(pluginRoot, ".claude-plugin/plugin.json"));
const marketplace = readJson(path.join(root, ".claude-plugin/marketplace.json"));

describe("Claude Code plugin manifest", () => {
    it("has no version before the first release, then the same version as package.json", () => {
        // Claude Code keeps an installed copy until `version` changes; without one, installs track the commit.
        if (pkg.version === "0.0.0") {
            expect(manifest).not.toHaveProperty("version");
        } else {
            expect(manifest.version).toBe(pkg.version);
        }
    });

    it("lists exactly one marketplace entry whose name matches the plugin manifest", () => {
        const entries = marketplaceEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.name).toBe(manifest.name);
    });

    it("points the marketplace source at a folder that holds the plugin manifest", () => {
        const entries = marketplaceEntries();
        const source = entries[0]?.source ?? "";
        expect(source.startsWith("./")).toBe(true);
        expect(fs.existsSync(path.join(root, source, ".claude-plugin/plugin.json"))).toBe(true);
        expect(path.resolve(root, source)).toBe(pluginRoot);
    });

    it("ships the skills that package.json lists in `files`", () => {
        expect(pkg.files).toContain("plugins/opdk/skills");
    });
});

describe("skills", () => {
    const names = fs
        .readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    it("has the six module skills and the audit skill", () => {
        expect(names.sort()).toEqual(["audit", "build", "demo", "e2e", "release", "scanner", "unit"]);
    });

    it.each(names)("%s: name matches its folder and the description fits the selection limit", (name) => {
        const text = fs.readFileSync(path.join(pluginRoot, "skills", name, "SKILL.md"), "utf8");
        expect(frontmatterField(text, "name")).toBe(name);
        const description = frontmatterField(text, "description");
        expect(description).toBeDefined();
        expect(description?.length ?? 0).toBeGreaterThan(0);
        // A folded or literal block would make the one-line reader above see only its indicator.
        expect(description).not.toMatch(/^[>|]/);
        expect(description?.length ?? 0).toBeLessThanOrEqual(MAX_DESCRIPTION);
    });

    it("every eval case selects a skill that exists", () => {
        const evals = path.join(pluginRoot, "evals");
        const cases = fs.readdirSync(evals, { withFileTypes: true })
            // `claude plugin eval` writes its reports to evals/results/.
            .filter((entry) => entry.isDirectory() && entry.name !== "results");
        expect(cases.map((entry) => entry.name).sort()).toEqual(names.map((name) => `select-${name}`).sort());
    });
});
