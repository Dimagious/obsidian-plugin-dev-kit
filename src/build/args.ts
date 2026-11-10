export interface BuildArgs {
    readonly vault: boolean;
    /** The directory after `--vault`, when given. Otherwise `VAULT_PLUGIN` is used. */
    readonly vaultDir?: string;
    readonly watch: boolean;
    /** Overwrite a vault folder that holds another plugin. */
    readonly force: boolean;
}

const EMPTY_VAULT = "--vault needs a non-empty directory: use --vault=<dir> or --vault <dir>.";

/** Pure parsing of `opdk build` arguments. Throws a message that says what to type instead. */
export function parseBuildArgs(args: readonly string[]): BuildArgs {
    let vault = false;
    let vaultDir: string | undefined;
    let watch = false;
    let force = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? "";
        if (arg === "--watch") {
            watch = true;
        } else if (arg === "--force") {
            force = true;
        } else if (arg === "--vault") {
            vault = true;
            const next = args[i + 1];
            if (next === "") {
                throw new Error(EMPTY_VAULT);
            }
            if (next !== undefined && !next.startsWith("-")) {
                vaultDir = next;
                i++;
            }
        } else if (arg.startsWith("--vault=")) {
            vault = true;
            vaultDir = arg.slice("--vault=".length);
            if (vaultDir === "") {
                throw new Error(EMPTY_VAULT);
            }
        } else {
            throw new Error(`Unknown argument "${arg}" for "opdk build". Run "opdk build --help" for the options.`);
        }
    }
    if (watch && !vault) {
        throw new Error("--watch only works together with --vault: use `opdk build --vault --watch`.");
    }
    if (force && !vault) {
        throw new Error("--force only works together with --vault: use `opdk build --vault --force`.");
    }
    return { vault, ...(vaultDir !== undefined && { vaultDir }), watch, force };
}
