import type { Manifest } from "../config/types.js";
import type { Finding } from "./findings.js";

/**
 * `manifest.json`: the description must not begin with the plugin name; the scorecard counts
 * "<Name> is a ..." as redundant. The name comes from the manifest, so no plugin is hardcoded. The scanner's ESLint
 * configuration switches `obsidianmd/validate-manifest` off for `manifest.json`, so this is not covered there.
 */
export function checkManifestDescription(manifest: Manifest): Finding[] {
    const description = manifest.description ?? "";
    const name = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b after a name ending in a symbol (for example "Foo+") would never match; the lookahead is the same test.
    if (!new RegExp(`^\\s*${name}(?![A-Za-z0-9_])`, "i").test(description)) {
        return [];
    }
    return [
        {
            check: "meta",
            file: "manifest.json",
            line: 1,
            rule: "manifest-description-no-name-prefix",
            message: `The description must not start with the plugin name. Current: ${JSON.stringify(description.slice(0, 80))}`,
        },
    ];
}
