import { warningProblem, type Problem } from "./problems.js";
import { asRecord } from "./json.js";

/**
 * The scripts the community directory tries, in its order (external.md, FAQ source 2026-08-07): the first one that
 * exists is what rebuilds `main.js` from the tagged commit.
 */
export const DIRECTORY_BUILD_SCRIPTS = ["build", "build:plugin", "compile"] as const;

/** `opdk build` as a command, not `opdk build-css`, and not the dev-vault build. */
const PRODUCTION_BUILD = /\bopdk\s+build(?![\w-])(?!.*--(?:vault|watch))/;

/**
 * Warns when the script the directory runs does not call `opdk build`. The release check builds with the kit's
 * options, but the directory builds with that script, so a different script can produce other bytes. A script that
 * only calls another npm script is not followed.
 */
export function checkBuildScript(packageJson: unknown): Problem[] {
    const scripts = asRecord(asRecord(packageJson)?.scripts) ?? {};
    const name = DIRECTORY_BUILD_SCRIPTS.find((candidate) => typeof scripts[candidate] === "string");
    if (name === undefined) {
        return [
            warningProblem(
                "build",
                `package.json has none of the scripts ${DIRECTORY_BUILD_SCRIPTS.map((script) => `"${script}"`).join(", ")}, so the community directory has nothing to rebuild main.js with.`,
                'Add "build": "opdk build" to scripts in package.json.',
            ),
        ];
    }
    const command = String(scripts[name]);
    if (PRODUCTION_BUILD.test(command)) {
        return [];
    }
    return [
        warningProblem(
            "build",
            `package.json scripts.${name} is "${command}" and does not run \`opdk build\`. The directory rebuilds main.js with that script, so the bytes this check builds with the kit may not be the ones it compares.`,
            `Make scripts.${name} "opdk build", or call \`opdk build\` from it (a script that only calls another npm script is not followed).`,
        ),
    ];
}
