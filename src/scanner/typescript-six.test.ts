import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeTypescriptGap, readTypescriptNextToTypescriptEslint, redirectTypescript, SCAN_TYPESCRIPT_PACKAGE, typescriptInUse, useTypescriptSix } from "./typescript-six.js";

const DIR = path.join(path.sep, "kit", "node_modules", "typescript-6");

describe("redirectTypescript", () => {
    it("sends the bare package to its entry file", () => {
        expect(redirectTypescript("typescript", DIR)).toBe(path.join(DIR, "lib", "typescript.js"));
    });

    it("sends a file inside the package to the same file in the scan's copy", () => {
        expect(redirectTypescript("typescript/lib/tsserverlibrary.js", DIR)).toBe(path.join(DIR, "lib", "tsserverlibrary.js"));
        expect(redirectTypescript("typescript/package.json", DIR)).toBe(path.join(DIR, "package.json"));
    });

    it.each(["typescript-eslint", "typescript-6", "typescripts", "./typescript", "@typescript-eslint/parser", "node:fs", ""])("leaves %j alone", (specifier) => {
        expect(redirectTypescript(specifier, DIR)).toBeUndefined();
    });
});

describe("useTypescriptSix", () => {
    it("finds the TypeScript 6 the kit carries, and says which version it is", () => {
        const source = useTypescriptSix();
        expect(source.version).toMatch(/^6\./);
        expect(path.basename(source.dir)).toBe(SCAN_TYPESCRIPT_PACKAGE);
    });

    it("makes a bare require('typescript') load that copy, which is what typescript-eslint does", () => {
        const source = useTypescriptSix();
        expect(source.forced).toBe(true);
        const requireHere = createRequire(import.meta.url);
        // The kit's own devDependency `typescript` is another file: if the hook did nothing these would differ.
        expect(requireHere.resolve("typescript")).not.toBe(path.join(source.dir, "lib", "typescript.js"));
        expect(requireHere("typescript")).toBe(requireHere(path.join(source.dir, "lib", "typescript.js")));
    });

    it("makes typescript-eslint's own typescript the copy it carries, whatever the plugin installed", () => {
        const source = useTypescriptSix();
        const fromEstree = createRequire(createRequire(createRequire(import.meta.url).resolve("typescript-eslint")).resolve("@typescript-eslint/typescript-estree"));
        const ts: unknown = fromEstree("typescript");
        expect(ts).toBe(createRequire(import.meta.url)(path.join(source.dir, "lib", "typescript.js")));
    });

    it("returns the same answer when called again", () => {
        expect(useTypescriptSix()).toBe(useTypescriptSix());
    });
});

describe("readTypescriptNextToTypescriptEslint", () => {
    it("reads a version from the install", () => {
        expect(readTypescriptNextToTypescriptEslint()).toMatch(/^\d+\.\d+\.\d+/);
    });
});

describe("describeTypescriptGap", () => {
    const hooked = { dir: DIR, version: "6.0.3", forced: true };
    const unhooked = { ...hooked, forced: false };

    it("says nothing when the compiler was switched", () => {
        expect(describeTypescriptGap(hooked, "5.9.3")).toBeUndefined();
    });

    it("says nothing when the compiler in use is already 6 or later", () => {
        expect(describeTypescriptGap(unhooked, "6.0.3")).toBeUndefined();
    });

    it("names the version in use, what it hides and the way out when the switch is not possible and TypeScript is older than 6", () => {
        const message = describeTypescriptGap(unhooked, "5.9.3");
        expect(message).toContain("TypeScript 5.9.3");
        expect(message).toContain("TypeScript 6");
        expect(message).toContain("moment(...)");
        expect(message).toContain("module.registerHooks");
        expect(message).toContain("Node 22.15 or later");
    });

    it("does not guess at a version it cannot read", () => {
        expect(describeTypescriptGap(unhooked, "next")).toBeUndefined();
    });
});

describe("typescriptInUse", () => {
    const hooked = { dir: DIR, version: "6.0.3", forced: true };

    it("is the kit's version when the hook is installed, without reading the plugin's", () => {
        expect(typescriptInUse(hooked, () => "5.9.3")).toBe("6.0.3");
    });

    it("is the plugin's own version when the hook could not be installed, not the kit's 6", () => {
        expect(typescriptInUse({ ...hooked, forced: false }, () => "5.9.3")).toBe("5.9.3");
    });
});
