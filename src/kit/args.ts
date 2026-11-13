export interface UpgradeArgs {
    /** `vX.Y.Z`; undefined means the latest release. */
    readonly target: string | undefined;
    readonly dryRun: boolean;
}

const USAGE_HINT = 'Run "opdk kit --help".';

/** Parses what follows `opdk kit upgrade`. `0.2.0` and `v0.2.0` both mean the tag `v0.2.0`. */
export function parseUpgradeArgs(args: readonly string[]): UpgradeArgs {
    let target: string | undefined;
    let dryRun = false;
    for (const arg of args) {
        if (arg === "--dry-run") {
            dryRun = true;
        } else if (/^v?\d+\.\d+\.\d+$/.test(arg) && target === undefined) {
            target = arg.startsWith("v") ? arg : `v${arg}`;
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown option "${arg}" for "opdk kit upgrade". ${USAGE_HINT}`);
        } else {
            throw new Error(`"${arg}" is not a kit release tag${target === undefined ? "" : " (one is enough)"}. Write it like v0.2.0, or leave it out for the latest release. ${USAGE_HINT}`);
        }
    }
    return { target, dryRun };
}
