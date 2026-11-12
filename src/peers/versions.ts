/** A semantic version reduced to what the peer checks compare. */
export interface ParsedVersion {
    readonly major: number;
    readonly minor: number;
}

/** `5.1.0`, `v5.1.0`, `5.0.0-beta.1`: the numbers up front. Anything else is not a version. */
export function parseVersion(version: string): ParsedVersion | undefined {
    const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    return { major: Number(match[1]), minor: Number(match[2]) };
}

/** A package a module needs the plugin to install, with the versions it accepts. */
export interface PeerRule {
    readonly name: string;
    /** Lowest accepted major version. */
    readonly minMajor: number;
    /** Highest accepted major version; omitted means no upper bound. */
    readonly maxMajor?: number;
    /** Lowest accepted minor version inside `minMajor` (Playwright: 1.62). Default 0. */
    readonly minMinor?: number;
    /** The range as the message and the install command show it, for example `^5.0.0` or `>=30`. */
    readonly range: string;
}

/** Reads the installed version of a package as the plugin resolves it; `undefined` when it is not installed. */
export type VersionReader = (name: string) => string | undefined;

/** One thing to fix: what is wrong, and the `name@range` that fixes it. */
export interface PeerProblem {
    readonly message: string;
    readonly install: string;
}

/** Compares the installed version with the rule. Returns the problem, or `undefined` when the version is accepted. */
export function checkRule(rule: PeerRule, installed: string | undefined): PeerProblem | undefined {
    const install = `${rule.name}@${rule.range}`;
    if (installed === undefined) {
        return { message: `"${rule.name}" is not installed; the kit needs ${rule.range}.`, install };
    }
    const parsed = parseVersion(installed);
    if (parsed === undefined) {
        return { message: `"${rule.name}" reports the version "${installed}", which is not a version number; the kit needs ${rule.range}.`, install };
    }
    const belowMinimum = parsed.major < rule.minMajor || (parsed.major === rule.minMajor && parsed.minor < (rule.minMinor ?? 0));
    const aboveMaximum = rule.maxMajor !== undefined && parsed.major > rule.maxMajor;
    if (belowMinimum || aboveMaximum) {
        return { message: `"${rule.name}" ${installed} is installed; the kit needs ${rule.range}.`, install };
    }
    return undefined;
}

/** Packs the problems into one error message: a line each, then one install command that fixes all of them. */
export function formatPeerError(prefix: string, problems: readonly PeerProblem[]): string {
    const lines = problems.map((problem) => `${prefix}: ${problem.message}`);
    // `electron@>=39.0.0` unquoted is a redirect in a shell.
    const specs = problems.map((problem) => (/[<>|\s]/.test(problem.install) ? `"${problem.install}"` : problem.install));
    const command = `npm install --save-dev ${specs.join(" ")}`;
    return `${lines.join("\n")}\nRun: ${command}`;
}
