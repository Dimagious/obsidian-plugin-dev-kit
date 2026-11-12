import { checkRule, formatPeerError, type PeerProblem, type PeerRule, type VersionReader } from "../peers/versions.js";

/** The Vitest major the preset is written and tested against. */
const VITEST: PeerRule = { name: "vitest", minMajor: 5, maxMajor: 5, range: "^5.0.0" };

/**
 * jsdom 30 is the version the DOM project and the kit's own tests run on, and the lowest one tested. Older jsdom
 * versions may work, but the kit makes no promise about them: a plugin on one gets this message instead of a
 * failure inside the polyfill.
 */
const JSDOM: PeerRule = { name: "jsdom", minMajor: 30, range: ">=30.0.0" };

const COVERAGE = "@vitest/coverage-v8";

/**
 * What the unit preset needs from the plugin's `node_modules`, as a list of problems (empty when all is well):
 * Vitest 5, `@vitest/coverage-v8` at the same version, and jsdom 30 or newer when `needsDom`. The plugin installs
 * these itself; the kit declares no peer dependency on them, because npm checks an optional peer whenever it is
 * installed and a plugin on an older Vitest could not install the kit at all.
 */
export function findUnitPeerProblems(read: VersionReader, needsDom: boolean): PeerProblem[] {
    const problems: PeerProblem[] = [];
    const vitest = read(VITEST.name);
    const vitestProblem = checkRule(VITEST, vitest);
    if (vitestProblem !== undefined) problems.push(vitestProblem);
    const coverage = read(COVERAGE);
    if (vitestProblem !== undefined || vitest === undefined) {
        // Vitest itself is wrong, so there is no version to match yet: the coverage package has to fit the same range.
        const coverageProblem = checkRule({ ...VITEST, name: COVERAGE }, coverage);
        if (coverageProblem !== undefined) problems.push(coverageProblem);
    } else if (coverage === undefined) {
        problems.push({ message: `"${COVERAGE}" is not installed; the kit needs the same version as "vitest" (${vitest}).`, install: `${COVERAGE}@${vitest}` });
    } else if (coverage !== vitest) {
        problems.push({
            message: `"${COVERAGE}" ${coverage} is installed next to "vitest" ${vitest}; the two must be the same version.`,
            install: `${COVERAGE}@${vitest}`,
        });
    }
    if (needsDom) {
        const jsdomProblem = checkRule(JSDOM, read(JSDOM.name));
        if (jsdomProblem !== undefined) problems.push(jsdomProblem);
    }
    return problems;
}

/** Throws one error with every problem and the command that fixes them; returns when the plugin's versions fit. */
export function assertUnitPeers(read: VersionReader, needsDom: boolean): void {
    const problems = findUnitPeerProblems(read, needsDom);
    if (problems.length > 0) throw new Error(formatPeerError("defineUnitConfig()", problems));
}
