import doiuse from "doiuse";
import postcss from "postcss";
import type { Finding } from "./findings.js";
import type { SourceFile } from "./code-checks.js";

/**
 * The Chromium that Obsidian 1.11.4 runs on (Electron 39, Chrome 142): the browser the scanner names in
 * "Unexpected browser feature ... is only partially supported by Obsidian 1.11.4". Raise it, together with the
 * mirrored scanner configuration, when the scanner names a newer Obsidian.
 */
export const OBSIDIAN_BROWSERS: readonly string[] = ["chrome 142"];
export const OBSIDIAN_VERSION = "1.11.4";

/**
 * Scorecard CSS, over the files given: the public scanner walks the whole repository, not only what ships in
 * `styles.css`. On 2026-11-09 the listing reported three kinds of finding, and this check reproduces each:
 *
 * - "Avoid !important": any `!important` in a declaration.
 * - "Avoid :has": any `:has(` in a selector, for its invalidation cost.
 * - "Unexpected browser feature ... is (only partially) supported by Obsidian 1.11.4": caniuse data through
 *   doiuse, the library behind stylelint-no-unsupported-browser-features, against OBSIDIAN_BROWSERS. It matched
 *   the listing exactly: `text-decoration-line` and `text-decoration-thickness` (partial), `columns`,
 *   `column-gap` and `break-inside` (partial), `ui-monospace` (not supported).
 *
 * Comments are parsed out by PostCSS, so prose cannot trip a rule. A file PostCSS cannot parse is reported as a
 * `css-syntax` finding instead of aborting the scan.
 */
export async function checkCss(files: readonly SourceFile[]): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const file of files) {
        const add = (rule: string, node: postcss.Node, message: string): void => {
            findings.push({ check: "css", file: file.path, line: node.source?.start?.line ?? 1, rule, message });
        };
        let root: postcss.Root;
        try {
            root = postcss.parse(file.text, { from: file.path });
        } catch (error) {
            const line = error instanceof postcss.CssSyntaxError && error.line !== undefined ? error.line : 1;
            const reason = error instanceof postcss.CssSyntaxError ? error.reason : String(error);
            findings.push({ check: "css", file: file.path, line, rule: "css-syntax", message: `Cannot parse the file: ${reason}` });
            continue;
        }
        root.walkDecls((declaration) => {
            if (declaration.important) {
                add("css-no-important", declaration, "`!important` is a scanner warning. Raise the selector's specificity instead.");
            }
        });
        root.walkRules((rule) => {
            if (rule.selector.includes(":has(")) {
                add("css-no-has", rule, "`:has()` is a scanner warning. Mark the element with a class instead.");
            }
        });
        await postcss([
            doiuse({
                browsers: OBSIDIAN_BROWSERS,
                onFeatureUsage: (usage) => {
                    const support = usage.featureData?.partial !== undefined ? "only partially supported" : "not supported";
                    add(
                        `css-browser-feature/${usage.feature}`,
                        usage.usage,
                        `"${usage.feature}" is ${support} by ${OBSIDIAN_BROWSERS.join(", ")} (the scanner's Obsidian ${OBSIDIAN_VERSION}).`,
                    );
                },
            }),
        ]).process(file.text, { from: file.path });
    }
    return findings;
}
