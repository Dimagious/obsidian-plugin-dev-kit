/** Two kit releases for tests: v0.1.0 and v0.2.0, with made-up commits. */
export const OLD_SHA = "6e33ca4f10b24fc9f7547f41ea9902fe30ebb362";
export const NEW_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const kit = "Dimagious/obsidian-plugin-dev-kit";

export function packageJsonText(tag: string): string {
    return `${JSON.stringify({ name: "fixture-plugin", version: "1.0.0", devDependencies: { "obsidian-plugin-dev-kit": `github:${kit}#${tag}`, typescript: "^5.6.0" } }, null, 2)}\n`;
}

export function lockText(sha: string, version: string): string {
    return `${JSON.stringify(
        {
            name: "fixture-plugin",
            version: "1.0.0",
            lockfileVersion: 3,
            packages: {
                "": { name: "fixture-plugin", version: "1.0.0", devDependencies: { "obsidian-plugin-dev-kit": "github:" + kit + "#v" + version } },
                "node_modules/obsidian-plugin-dev-kit": { version, resolved: `git+ssh://git@github.com/${kit}.git#${sha}`, dev: true },
            },
        },
        null,
        2,
    )}\n`;
}

/** A plugin workflow with the kit's `uses:` line, optionally followed by a comment. */
export function workflowText(workflow: string, sha: string, comment: string | undefined): string {
    return [
        "name: ci",
        "on:",
        "  push:",
        "jobs:",
        "  kit:",
        `    uses: ${kit}/.github/workflows/${workflow}@${sha}${comment === undefined ? "" : ` # ${comment}`}`,
        "  other:",
        "    runs-on: ubuntu-24.04",
        "    steps:",
        "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4.2.0",
        "",
    ].join("\n");
}

/** `git ls-remote --tags` output for the kit: v0.1.0 annotated (tag object, then the peeled commit), v0.2.0 lightweight, a pre-release and a non-release ref. */
export const LS_REMOTE = [
    `1111111111111111111111111111111111111111\trefs/tags/v0.1.0`,
    `${OLD_SHA}\trefs/tags/v0.1.0^{}`,
    `${NEW_SHA}\trefs/tags/v0.2.0`,
    `2222222222222222222222222222222222222222\trefs/tags/v0.3.0-beta.1`,
    `3333333333333333333333333333333333333333\trefs/tags/nightly`,
    "",
].join("\n");
