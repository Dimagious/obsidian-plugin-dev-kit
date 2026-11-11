// Runs `claude plugin validate --strict --json` on the marketplace and the plugin, and fails on any error or warning.
// One warning is allowed while the kit is unreleased (package.json 0.0.0): the plugin has no `version` on purpose,
// so an installed copy follows `main` instead of freezing (see CONTRIBUTING, Releases).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TARGETS = [".", "plugins/opdk"];
const unreleased = JSON.parse(readFileSync("package.json", "utf8")).version === "0.0.0";
const allowed = (message) => unreleased && message.startsWith("No version specified");

/** Collects `errors` and `warnings` arrays at any depth of the report. */
function collect(node, found) {
    if (Array.isArray(node)) {
        for (const item of node) collect(item, found);
    } else if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            if ((key === "errors" || key === "warnings") && Array.isArray(value)) {
                for (const item of value) found.push({ kind: key, path: item.path ?? "", message: String(item.message ?? item) });
            } else {
                collect(value, found);
            }
        }
    }
    return found;
}

let failed = false;
for (const target of TARGETS) {
    const run = spawnSync("claude", ["plugin", "validate", target, "--strict", "--json"], { encoding: "utf8" });
    if (run.error) {
        console.error(`plugin:validate: could not run claude (${run.error.message}). Install Claude Code first.`);
        process.exit(2);
    }
    let report;
    try {
        report = JSON.parse(run.stdout);
    } catch {
        console.error(`plugin:validate: ${target}: no JSON from claude plugin validate (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
        process.exit(2);
    }
    const problems = collect(report, []).filter((item) => item.kind === "errors" || !allowed(item.message));
    for (const item of problems) {
        console.error(`plugin:validate: ${target}: ${item.kind.slice(0, -1)} at ${item.path}: ${item.message}`);
    }
    if (problems.length > 0) {
        failed = true;
    } else {
        console.log(`plugin:validate: ${target}: passed (strict${unreleased ? ", no version until the first release" : ""})`);
    }
}
process.exit(failed ? 1 : 0);
