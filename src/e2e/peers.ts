import { checkRule, formatPeerError, type PeerProblem, type PeerRule, type VersionReader } from "../peers/versions.js";

/** The oldest Playwright the kit's e2e module has been run on. */
const PLAYWRIGHT: PeerRule = { name: "@playwright/test", minMajor: 1, maxMajor: 1, minMinor: 62, range: "^1.62.0" };

/** The oldest Electron the kit's e2e module has been run on; later versions are accepted. */
const ELECTRON: PeerRule = { name: "electron", minMajor: 39, range: ">=39.0.0" };

/**
 * What the e2e module needs from the plugin's `node_modules`, as a list of problems (empty when all is well). The
 * kit declares no peer dependency on these: npm checks an optional peer whenever it is installed, so a plugin on an
 * older Playwright or Electron could not install the kit at all, even if it never runs e2e.
 */
export function findE2ePeerProblems(read: VersionReader): PeerProblem[] {
    return [PLAYWRIGHT, ELECTRON].flatMap((rule) => checkRule(rule, read(rule.name)) ?? []);
}

/** Throws one error with every problem and the command that fixes them; `source` names the caller in the message. */
export function assertE2ePeers(read: VersionReader, source: string): void {
    const problems = findE2ePeerProblems(read);
    if (problems.length > 0) throw new Error(formatPeerError(source, problems));
}
