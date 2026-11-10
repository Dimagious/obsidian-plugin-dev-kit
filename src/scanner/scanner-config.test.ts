import { readFileSync } from "node:fs";
import type { Linter } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { describe, expect, it } from "vitest";
import { createScannerConfig, MIRRORED_OBSIDIANMD_VERSION, SCANNER_IGNORES } from "./scanner-config.js";

function kitDependency(name: string): unknown {
    const text = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("dependencies" in parsed)) {
        throw new Error("package.json has no dependencies");
    }
    const dependencies = parsed.dependencies;
    return typeof dependencies === "object" && dependencies !== null && name in dependencies
        ? (dependencies as Record<string, unknown>)[name]
        : undefined;
}

function readPackageJson(path: URL): Record<string, unknown> {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`${path.href} is not an object`);
    }
    return Object.fromEntries(Object.entries(parsed));
}

function peerRange(manifest: Record<string, unknown>, name: string): unknown {
    const peers = manifest.peerDependencies;
    return typeof peers === "object" && peers !== null && name in peers ? Object.entries(peers).find(([key]) => key === name)?.[1] : undefined;
}

/** What the kit adds after the preset: the first entry (parser options) and the preset itself are skipped. */
function ownBlocks(config: readonly Linter.Config[]): Linter.Config[] {
    return config.slice(1 + obsidianmd.configs.recommended.length);
}

function parserOptions(entry: Linter.Config | undefined): Record<string, unknown> {
    const value: unknown = entry?.languageOptions?.parserOptions;
    return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

function rulesFor(config: readonly Linter.Config[], file: string): Record<string, unknown> {
    const match = ownBlocks(config).find((entry) => entry.files?.flat().includes(file) === true);
    return { ...match?.rules };
}

describe("the mirrored scanner configuration", () => {
    // The scanner's configuration is a copy of upstream's docs/configuration.md. When eslint-plugin-obsidianmd is
    // bumped, diff that file at the new tag against scanner-config.ts, update the copy and the date in its header,
    // then change MIRRORED_OBSIDIANMD_VERSION. This test is what makes a bump stop here.
    it("was diffed against the exact version the kit depends on", () => {
        expect(kitDependency("eslint-plugin-obsidianmd")).toBe(MIRRORED_OBSIDIANMD_VERSION);
    });

    // typescript is a peer of the kit because typescript-eslint needs it; the kit must not promise a wider
    // range than the typescript-eslint it pins.
    it("declares the typescript peer range of the typescript-eslint it pins", () => {
        const kit = readPackageJson(new URL("../../package.json", import.meta.url));
        const tseslint = readPackageJson(new URL("../../node_modules/typescript-eslint/package.json", import.meta.url));
        expect(peerRange(tseslint, "typescript")).toEqual(expect.any(String));
        expect(peerRange(kit, "typescript")).toBe(peerRange(tseslint, "typescript"));
    });

    it("was diffed against the version that is installed", () => {
        expect(obsidianmd.meta.version).toBe(MIRRORED_OBSIDIANMD_VERSION);
    });

    it("keeps all 48 of upstream's ignored paths (0.5.1), the first three being its stand-ins for bundled output", () => {
        expect(SCANNER_IGNORES).toHaveLength(48);
        expect(SCANNER_IGNORES).toEqual(expect.arrayContaining(["main.js", "**/scripts/**", "**/docs/**", "**/*.test.*", "**/e2e/**"]));
    });
});

describe("createScannerConfig", () => {
    const typed = createScannerConfig({ cwd: "/plugin", typeAware: true });
    const untyped = createScannerConfig({ cwd: "/plugin", typeAware: false });

    it("points the project service at the plugin root", () => {
        expect(parserOptions(typed[0])).toEqual({ projectService: true, tsconfigRootDir: "/plugin" });
    });

    it("builds on obsidianmd's recommended preset", () => {
        expect(typed.slice(1, 1 + obsidianmd.configs.recommended.length)).toEqual(obsidianmd.configs.recommended);
    });

    it("keeps the security rules at error", () => {
        const rules = rulesFor(typed, "**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}");
        for (const rule of [
            "no-eval",
            "no-unsanitized/method",
            "no-unsanitized/property",
            "obsidianmd/regex-lookbehind",
            "obsidianmd/no-forbidden-elements",
        ]) {
            expect(rules[rule]).toBe("error");
        }
    });

    it("switches off what the scanner skips, and the command-id rules", () => {
        const rules = rulesFor(typed, "**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}");
        for (const rule of [
            "no-undef",
            "@typescript-eslint/no-unsafe-call",
            "@typescript-eslint/restrict-template-expressions",
            "import/no-unresolved",
            "obsidianmd/commands/no-command-in-command-id",
            "obsidianmd/commands/no-plugin-id-in-command-id",
        ]) {
            expect(rules[rule]).toBe("off");
        }
    });

    it("reports implied eval once per call: the core rule for JavaScript, typescript-eslint's for TypeScript", () => {
        expect(rulesFor(typed, "**/*.{js,cjs,mjs,jsx}")).toEqual({ "no-implied-eval": "error" });
        expect(rulesFor(typed, "**/*.{ts,cts,mts,tsx}")).toEqual({ "@typescript-eslint/no-implied-eval": "error" });
    });

    it("leaves manifest and licence validation to the scanner", () => {
        expect(rulesFor(typed, "manifest.json")).toEqual({ "obsidianmd/validate-manifest": "off" });
        expect(rulesFor(typed, "LICENSE")).toEqual({ "obsidianmd/validate-license": "off" });
    });

    it("does not report unused disable comments", () => {
        const options = ownBlocks(typed).find((entry) => entry.linterOptions !== undefined)?.linterOptions;
        expect(options).toEqual({ reportUnusedDisableDirectives: "off", reportUnusedInlineConfigs: "off" });
    });

    it("ends with the ignored paths", () => {
        expect(typed.at(-1)).toEqual({ ignores: [...SCANNER_IGNORES] });
        expect(untyped.at(-1)).toEqual({ ignores: [...SCANNER_IGNORES] });
    });

    it("adds the untyped block only for files no tsconfig covers", () => {
        // The untyped block, and the core no-implied-eval that takes over from the type-aware rule it switches off.
        expect(untyped).toHaveLength(typed.length + 2);
        const block = ownBlocks(untyped).find((entry) => parserOptions(entry).projectService === false);
        expect(parserOptions(block)).toEqual({ projectService: false, project: null });
        expect(ownBlocks(typed).some((entry) => parserOptions(entry).projectService === false)).toBe(false);
    });

    it("switches off typescript-eslint's and obsidianmd's type-aware rules in the untyped block", () => {
        const block = ownBlocks(untyped).find((entry) => parserOptions(entry).projectService === false);
        expect(block?.rules?.["@typescript-eslint/no-floating-promises"]).toBe("off");
        expect(block?.rules?.["obsidianmd/no-unsupported-api"]).toBe("off");
        expect(block?.rules?.["obsidianmd/no-plugin-as-component"]).toBe("off");
        // Rules that need no types stay on.
        expect(block?.rules?.["obsidianmd/prefer-window-timers"]).toBeUndefined();
        expect(block?.rules?.["obsidianmd/prefer-active-doc"]).toBeUndefined();
    });

    it("turns the core no-implied-eval on for TypeScript when type-aware no-implied-eval is off", () => {
        const block = ownBlocks(untyped).find((entry) => entry.files?.flat().includes("**/*.{ts,cts,mts,tsx}") === true && entry.rules?.["no-implied-eval"] === "error");
        expect(block).toBeDefined();
        expect(typed.some((entry) => entry.rules?.["no-implied-eval"] === "error" && entry.files?.flat().includes("**/*.{ts,cts,mts,tsx}") === true)).toBe(false);
    });
});
