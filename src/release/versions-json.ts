import { errorProblem, warningProblem, type Problem } from "./problems.js";
import { asRecord, findFormatIssue, type Loaded } from "./json.js";
import { compareVersions, isSemver } from "./semver.js";

const GROUP = "versions.json";

/**
 * The versions.json rules. The format check is the official action's (`validateVersionsJson` in
 * obsidianmd/obsidian-workflows `src/manifest.ts`: an object of semver keys to semver values), with two more that
 * the directory relies on: the current version maps to the manifest's `minAppVersion`, and `minAppVersion` never
 * goes down as plugin versions go up (Obsidian installs the newest version an old app can run, and a lower
 * mapping on a newer version would hand it a build that needs a newer app).
 *
 * Deviations from the action: a key or value that is not a version is a warning, as it is upstream (only the
 * three rules above and the file itself being missing, invalid or not an object fail the check). Beyond upstream:
 * a missing file is an error, because the directory relies on it, and the current-version and never-lower rules
 * are errors.
 */
export function checkVersionsJson(loaded: Loaded, version: string, minAppVersion: string | undefined): Problem[] {
    if (loaded.kind === "missing") {
        return [errorProblem(GROUP, "versions.json is missing.", missingHint(version, minAppVersion))];
    }
    if (loaded.kind === "invalid") {
        return [errorProblem(GROUP, `versions.json is not valid JSON: ${loaded.message}.`, "Fix the syntax.")];
    }
    const versions = asRecord(loaded.value);
    if (versions === undefined) {
        return [errorProblem(GROUP, "versions.json must be an object mapping plugin versions to minimum app versions.", `Write { "${version}": "1.5.0" }.`)];
    }
    const problems: Problem[] = [];
    // `opdk release <bump>` rewrites this file and refuses one it cannot write back as it is: say so before release day.
    const issue = findFormatIssue(loaded.text, loaded.value, "versions.json");
    if (issue !== undefined) {
        problems.push(errorProblem(GROUP, issue.message, issue.hint));
    }
    for (const [key, value] of Object.entries(versions)) {
        if (!isSemver(key)) {
            problems.push(warningProblem(GROUP, `key "${key}" is not a version like 1.2.3.`, "Remove or fix the entry."));
        }
        if (typeof value !== "string" || !isSemver(value)) {
            problems.push(warningProblem(GROUP, `the value of "${key}" is not a version like 1.5.0.`, "Map each plugin version to the minimum Obsidian version as a string."));
        }
    }
    problems.push(...checkCurrent(versions, version, minAppVersion), ...checkNeverLower(versions));
    return problems;
}

/**
 * The hint for a missing file: a `node -e` command that writes it in the format the release writes back (two-space
 * indent, LF, final newline). It sits inside double quotes in the shell, so the script has no `$`, backtick, `!` or
 * inner double quote. The file name and the values must never contain quotes; versions are validated semver, so they
 * cannot.
 */
function missingHint(version: string, minAppVersion: string | undefined): string {
    if (minAppVersion === undefined || !isSemver(version) || !isSemver(minAppVersion)) {
        return "Create it next to manifest.json as an object that maps the plugin version to minAppVersion, written with JSON.stringify (two-space indent, final newline). `opdk release <patch|minor|major>` creates it too.";
    }
    const script = `require('fs').writeFileSync('versions.json', JSON.stringify({ '${version}': '${minAppVersion}' }, null, 2) + '\\n')`;
    return `Create it next to manifest.json with \`node -e "${script}"\`. \`opdk release <patch|minor|major>\` creates it too.`;
}

function checkCurrent(versions: Record<string, unknown>, version: string, minAppVersion: string | undefined): Problem[] {
    if (minAppVersion === undefined) {
        return [errorProblem(GROUP, `manifest.json has no minAppVersion, so ${version} cannot be mapped in versions.json.`, 'Add "minAppVersion" to manifest.json.')];
    }
    if (!Object.hasOwn(versions, version)) {
        return [errorProblem(GROUP, `versions.json has no entry for ${version}.`, `Add "${version}": "${minAppVersion}" as a new line in the same format (two-space indent, one entry per line), or let \`opdk release <patch|minor|major>\` add it for a new release.`)];
    }
    const mapped = versions[version];
    if (mapped !== minAppVersion) {
        return [
            errorProblem(
                GROUP,
                `versions.json maps ${version} to ${typeof mapped === "string" ? mapped : "a non-string"}, but manifest.json minAppVersion is ${minAppVersion}.`,
                "Make them equal. If this version is already released, change manifest.json: a released entry in versions.json stays as it is.",
            ),
        ];
    }
    return [];
}

function checkNeverLower(versions: Record<string, unknown>): Problem[] {
    const entries = Object.entries(versions)
        .filter((entry): entry is [string, string] => isSemver(entry[0]) && typeof entry[1] === "string" && isSemver(entry[1]))
        .sort(([a], [b]) => compareVersions(a, b) ?? 0);
    const problems: Problem[] = [];
    let highest: [string, string] | undefined;
    for (const [pluginVersion, minApp] of entries) {
        if (highest !== undefined && (compareVersions(minApp, highest[1]) ?? 0) < 0) {
            problems.push(
                errorProblem(
                    GROUP,
                    `${pluginVersion} needs Obsidian ${minApp}, lower than ${highest[1]} that ${highest[0]} needs.`,
                    "minAppVersion should only go up as the plugin version goes up. Check which of the two entries is wrong.",
                ),
            );
        } else if (highest === undefined || (compareVersions(minApp, highest[1]) ?? 0) > 0) {
            highest = [pluginVersion, minApp];
        }
    }
    return problems;
}
