import { errorProblem, warningProblem, type Problem } from "./problems.js";

const GROUP = "assets";

export interface AssetInput {
    /** The built main.js, undefined when the build did not write one. */
    readonly mainJs: Uint8Array | undefined;
    /** styles.css written by the CSS step, undefined when there is no CSS entry. */
    readonly builtCss: Uint8Array | undefined;
    /** The styles.css committed at the plugin root, undefined when there is none. */
    readonly rootCss: Uint8Array | undefined;
    /** Text of manifest.json at the plugin root. */
    readonly manifestText: string;
    /** Text of the manifest.json next to the built main.js when that is not the plugin root; undefined at the root. */
    readonly outputManifestText: string | undefined;
    /** Where the bundle goes, as the build config names it. */
    readonly outfile: string;
}

/**
 * What a GitHub release must hold: `main.js`, `manifest.json`, and `styles.css` only if the plugin has CSS. The
 * kit's build writes `main.js` and `styles.css`; the `manifest.json` asset is the one at the plugin root, so a copy
 * next to a bundle that is built outside the root must be that same file.
 */
export function checkAssets(input: AssetInput): Problem[] {
    const problems: Problem[] = [];
    if (input.mainJs === undefined) {
        problems.push(errorProblem(GROUP, `the build did not write ${input.outfile}.`, "Check build.outfile in opdk.config.mjs."));
    } else if (input.mainJs.length === 0) {
        problems.push(errorProblem(GROUP, `${input.outfile} is empty.`, "The entry point produced no code; check build.entry in opdk.config.mjs."));
    }
    const css = input.builtCss ?? input.rootCss;
    if (css === undefined) {
        problems.push(warningProblem(GROUP, "the plugin ships no styles.css (no CSS entry and no styles.css at the plugin root).", "Fine for a plugin without styles; otherwise create src/styles/main.css or set build.css.entry."));
    } else if (css.length === 0) {
        problems.push(errorProblem(GROUP, "styles.css is empty.", "Delete it, or put the plugin's styles in it: an empty asset lowers the scorecard."));
    }
    if (input.outputManifestText !== undefined && !sameJson(input.outputManifestText, input.manifestText)) {
        problems.push(errorProblem(GROUP, `the manifest.json next to ${input.outfile} differs from the one at the plugin root.`, "Release assets must carry the root manifest: copy it after the build, or build into the plugin root."));
    }
    return problems;
}

function sameJson(a: string, b: string): boolean {
    try {
        return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
    } catch {
        return a === b;
    }
}
