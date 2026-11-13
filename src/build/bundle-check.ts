/**
 * The bundle has to run where the plugin claims to run.
 *
 * `manifest.json` says `isDesktopOnly: false`, and on a phone there is no
 * Node: no `process`, no `require`, no `__dirname`. Desktop Obsidian is
 * Electron and has all three, so a bundle that reaches for them works
 * perfectly on the machine it was built on and fails on every block on a
 * phone, which is exactly how one plugin release shipped. esbuild was told
 * `--platform=node`, so it took the `node` branch of the `yaml` package's
 * export map and bundled the build that reads `process.env`.
 *
 * Nothing in `src/` refers to any of this; it arrives through a dependency's
 * export conditions, which is why reading our own sources cannot catch it and
 * the built file has to be checked instead.
 */

/** Each pattern is something that only exists under Node. */
const FORBIDDEN: readonly { readonly re: RegExp; readonly what: string }[] = [
    { re: /\bprocess\s*\.\s*(env|emitWarning|platform|version|cwd|argv)\b/, what: "a `process` reference" },
    { re: /require\(\s*["']node:/, what: "a `node:` builtin import" },
    { re: /\b__dirname\b|\b__filename\b/, what: "`__dirname` or `__filename`" },
];

/**
 * Minification renames the variable but keeps the property, so the property
 * names are what we look for. These come from the `yaml` Node build.
 */
const MARKERS: readonly string[] = ["LOG_TOKENS", "LOG_STREAM", "emitWarning"];

/** Returns one message per Node-only reference found in the bundle text; empty when the bundle is clean. */
export function findNodeOnlyReferences(code: string): string[] {
    const problems: string[] = [];
    for (const { re, what } of FORBIDDEN) {
        const hit = re.exec(code);
        if (hit) {
            problems.push(`${what}: ${JSON.stringify(hit[0])}`);
        }
    }
    for (const marker of MARKERS) {
        if (code.includes(marker)) {
            problems.push(`\`${marker}\`, which only the Node build of a dependency contains`);
        }
    }
    return problems;
}
