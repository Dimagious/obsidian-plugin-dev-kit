import { judgePins, readKitPins, readNpmPins, shortSha, type WorkflowFile } from "../kit/pins.js";
import { errorProblem, type GroupResult } from "./problems.js";
import type { ProjectFiles } from "./project-files.js";
import { valueOf } from "./project-files.js";

/** What the places agree on, as a sentence for the `✓` line. */
function agreement(verdict: ReturnType<typeof judgePins>, hasPackageJson: boolean, lockVersion: string | undefined, hasLock: boolean): string {
    // An npm install names no tag in package.json; the lockfile's version, when there is a lockfile, is the release then.
    const named = verdict.tag ?? lockVersion ?? (verdict.commit === undefined ? "one release" : shortSha(verdict.commit));
    const where = [
        ...(hasPackageJson ? ["package.json"] : []),
        ...(hasLock ? ["package-lock.json"] : []),
        ...(verdict.usesCount > 0 ? [`${String(verdict.usesCount)} workflow ${verdict.usesCount === 1 ? "line" : "lines"}`] : []),
    ];
    const commit = verdict.commit === undefined ? "" : ` (${shortSha(verdict.commit)})`;
    return `the kit is ${named}${commit} in ${where.join(", ")}`;
}

/**
 * The `kit` group: package.json, the lockfile and the workflow `uses:` lines name one kit release. A plugin that
 * does not use the kit, or does not call its workflows, has fewer places to compare and passes.
 */
export function checkKit(files: ProjectFiles, workflows: readonly WorkflowFile[]): GroupResult {
    const pins = readKitPins({ packageJson: valueOf(files.packageJson), lock: valueOf(files.lock), workflows });
    const verdict = judgePins(pins);
    if (pins.packageJson.length === 0 && pins.uses.length === 0) {
        return { group: "kit", passed: "obsidian-plugin-dev-kit is not a git dependency and no workflow calls it", problems: [] };
    }
    if (verdict.reasons.length === 0) {
        return { group: "kit", passed: agreement(verdict, pins.packageJson.length > 0, pins.lock?.version, pins.lock !== undefined), problems: [] };
    }
    if (pins.packageJson.length === 0 && pins.lock?.version !== undefined) {
        // Installed from npm: package.json names no tag, so the lockfile's version is the release to settle on.
        const version = pins.lock.version;
        // `opdk kit upgrade` takes only an exact, ^ or ~ version; any other spec (`file:`, `latest`, a range, an alias) needs a manual fix.
        const hint =
            readNpmPins(valueOf(files.packageJson)).length > 0
                ? `Run \`opdk kit upgrade v${version}\` to point every \`uses:\` line of the kit's workflows at the commit of v${version} (\`# v${version}\`) and to set package.json and the lockfile to that exact version; name another vX.Y.Z, or none for the latest release, to move to it instead. Then commit the result.`
                : `package.json asks for the kit with a spec \`opdk kit upgrade\` does not take (it takes an exact, ^ or ~ version or a GitHub tag). Install the release the workflows name with \`npm install -D -E obsidian-plugin-dev-kit@X.Y.Z\`, or set the commit of v${version} and the comment \`# v${version}\` in every \`uses:\` line of the kit's workflows. Then commit the result.`;
        return { group: "kit", passed: "", problems: [errorProblem("kit", "the kit is not pinned to one release.", hint, [...verdict.reasons, ...verdict.places])] };
    }
    // `opdk kit upgrade` only takes vX.Y.Z; a branch or other ref in package.json cannot be named there.
    const named = verdict.tag !== undefined && /^v\d+\.\d+\.\d+$/.test(verdict.tag) ? verdict.tag : undefined;
    const upgrade = named === undefined ? "`opdk kit upgrade`" : `\`opdk kit upgrade ${named}\``;
    const latest = named !== undefined ? " (`opdk kit upgrade` alone takes the latest release)" : " (it takes the latest release; `opdk kit upgrade vX.Y.Z` names one)";
    return {
        group: "kit",
        passed: "",
        problems: [
            errorProblem("kit", "the kit is not pinned to one release.", `Run ${upgrade} to rewrite the lockfile and the workflow pins to one commit${latest}, then commit the result.`, [...verdict.reasons, ...verdict.places]),
        ],
    };
}
