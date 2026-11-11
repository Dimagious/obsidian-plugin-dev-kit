import path from "node:path";

/** Where the seed vault of a run came from: the `seedVault` option, or the `OPDK_E2E_VAULT` env override. */
export type SeedVaultSource = "option" | "env";

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Pictures and films are published. A run aimed at someone's real vault through `OPDK_E2E_VAULT`, or at a seed vault
 * outside the plugin's own folder, would photograph private notes, so capture refuses unless the spec says it is
 * meant (`allowForeignVault: true`).
 */
export function assertCaptureAllowed(params: {
    source: SeedVaultSource;
    seedVault: string;
    /** The plugin folder the run started in; the seed vault is expected inside it. */
    cwd: string;
    allowForeignVault: boolean | undefined;
    action: string;
}): void {
    if (params.source === "env" && params.allowForeignVault !== true) {
        throw new Error(
            `${params.action} refused: OPDK_E2E_VAULT points this run at ${params.seedVault}, not at the plugin's own seed vault, ` +
                `and a picture or film of someone's real notes could be published by mistake. ` +
                `Unset OPDK_E2E_VAULT, or pass allowForeignVault: true if you mean to shoot that vault.`,
        );
    }
    if (params.allowForeignVault !== true && !isInside(params.cwd, params.seedVault)) {
        throw new Error(
            `${params.action} refused: the seed vault ${params.seedVault} lies outside the plugin folder ${params.cwd}, ` +
                `and a picture or film of a vault that is not the plugin's own could show private notes. ` +
                `Move the seed vault into the plugin folder, or pass allowForeignVault: true if you mean to shoot that vault.`,
        );
    }
}

/** The configured selectors plus the ones of this call, each once. */
export function mergeSelectors(configured: readonly string[], extra: readonly string[] | undefined): string[] {
    return [...new Set([...configured, ...(extra ?? [])])];
}

export function forbiddenMessage(selector: string, action: string): string {
    return (
        `${action} refused: an element matching the forbidden selector ${JSON.stringify(selector)} is visible, so it would be in the picture. ` +
        `Close or hide it before the shot, or remove the selector from demo.forbiddenSelectors if it is allowed here.`
    );
}
