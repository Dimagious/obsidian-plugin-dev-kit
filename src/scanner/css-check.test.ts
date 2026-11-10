import { describe, expect, it } from "vitest";
import type { SourceFile } from "./code-checks.js";
import { checkCss, OBSIDIAN_BROWSERS } from "./css-check.js";
import type { Finding } from "./findings.js";

const css = (text: string, filePath = "styles.css"): SourceFile => ({ path: filePath, text });
const summary = (findings: readonly Finding[]): string[] =>
    findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`);

describe("checkCss", () => {
    it("passes clean CSS", async () => {
        expect(await checkCss([css(".a { color: red; }\n.b > .c { margin: 0 auto; display: flex; }\n")])).toEqual([]);
    });

    it("passes without files", async () => {
        expect(await checkCss([])).toEqual([]);
    });

    it("flags !important with the declaration's line", async () => {
        const findings = await checkCss([css(".a {\n  color: red;\n  margin: 0 !important;\n}\n")]);
        expect(summary(findings)).toEqual(["styles.css:3 css-no-important"]);
        expect(findings[0]).toMatchObject({ check: "css" });
        expect(findings[0]?.message).toContain("Raise the selector's specificity");
    });

    it("flags :has() in a selector, also inside @media", async () => {
        const findings = await checkCss([css("@media (min-width: 1px) {\n  .a:has(.b) { color: red; }\n}\n")]);
        expect(summary(findings)).toEqual(["styles.css:2 css-no-has"]);
    });

    it("flags a feature Chrome 142 supports only partly, and says so", async () => {
        const findings = await checkCss([css(".a {\n  text-decoration-thickness: 2px;\n}\n")]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe("css-browser-feature/text-decoration");
        expect(findings[0]?.line).toBe(2);
        expect(findings[0]?.message).toContain("only partially supported by chrome 142");
        expect(findings[0]?.message).toContain("Obsidian 1.11.4");
    });

    it("flags a feature Chrome 142 lacks, and says so", async () => {
        const findings = await checkCss([css(".a { font-family: ui-monospace, monospace; }\n")]);
        expect(summary(findings)).toEqual(["styles.css:1 css-browser-feature/extended-system-fonts"]);
        expect(findings[0]?.message).toContain('"extended-system-fonts" is not supported by chrome 142');
    });

    it("does not flag features Chrome 142 supports fully", async () => {
        expect(await checkCss([css(".a { mask-image: none; inset: 0; aspect-ratio: 1; gap: 2px; }\n")])).toEqual([]);
    });

    it("reads comments as comments", async () => {
        const text = "/* never use !important or :has( here */\n.a { color: red; /* margin: 0 !important; */ }\n";
        expect(await checkCss([css(text)])).toEqual([]);
    });

    it("reports every file separately, with its own path", async () => {
        const findings = await checkCss([
            css(".a { color: red !important; }\n", "src/styles/a.css"),
            css(".b { color: red; }\n", "src/styles/b.css"),
            css(".c:has(.d) { color: red; }\n", "site/c.css"),
        ]);
        expect(summary(findings)).toEqual(["src/styles/a.css:1 css-no-important", "site/c.css:1 css-no-has"]);
    });

    it("reports a file PostCSS cannot parse instead of aborting, and goes on", async () => {
        const findings = await checkCss([css(".a { color: red;\n", "broken.css"), css(".b { margin: 0 !important; }\n", "ok.css")]);
        expect(summary(findings)).toEqual(["broken.css:1 css-syntax", "ok.css:1 css-no-important"]);
        expect(findings[0]?.message).toMatch(/^Cannot parse the file: /);
    });

    it("targets the Chromium of Obsidian 1.11.4", () => {
        expect(OBSIDIAN_BROWSERS).toEqual(["chrome 142"]);
    });
});
