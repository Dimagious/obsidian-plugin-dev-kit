import path from "node:path";

/** Where the macOS installer puts Obsidian's bootstrap asar. */
export const DEFAULT_MAC_APP_ASAR = "/Applications/Obsidian.app/Contents/Resources/app.asar";

export interface ObsidianPathInputs {
    /** `obsidianPath` option. */
    readonly option?: string | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly platform: NodeJS.Platform;
    readonly exists: (file: string) => boolean;
    /** Resolves a relative `option`/`OBSIDIAN_PATH` against this directory. */
    readonly cwd: string;
}

/**
 * Finds Obsidian's `app.asar`. Order: `OBSIDIAN_PATH`, the `obsidianPath` option, the macOS default. The first
 * source that is set wins and must exist; there is no silent fall-through to the next one, because a typo in an
 * explicit path would otherwise test a different Obsidian than the one you asked for.
 */
export function findObsidianAsar(inputs: ObsidianPathInputs): string {
    const fromEnv = inputs.env.OBSIDIAN_PATH;
    const explicit = fromEnv !== undefined && fromEnv !== "" ? { source: "OBSIDIAN_PATH", value: fromEnv } : undefined;
    const fromOption =
        inputs.option !== undefined && inputs.option !== "" ? { source: "obsidianPath", value: inputs.option } : undefined;
    const chosen = explicit ?? fromOption;
    if (chosen !== undefined) {
        const file = path.resolve(inputs.cwd, chosen.value);
        if (!inputs.exists(file)) {
            throw new Error(
                `${chosen.source} points to ${file}, which does not exist. ` +
                    `Set it to Obsidian's app.asar (on macOS: ${DEFAULT_MAC_APP_ASAR}).`,
            );
        }
        return file;
    }
    if (inputs.platform !== "darwin") {
        throw new Error(
            `No default Obsidian location for platform "${inputs.platform}". ` +
                `Set OBSIDIAN_PATH or the obsidianPath option to Obsidian's app.asar.`,
        );
    }
    if (!inputs.exists(DEFAULT_MAC_APP_ASAR)) {
        throw new Error(
            `Obsidian is not installed at ${DEFAULT_MAC_APP_ASAR}. ` +
                `Install Obsidian, or set OBSIDIAN_PATH or the obsidianPath option to its app.asar.`,
        );
    }
    return DEFAULT_MAC_APP_ASAR;
}
