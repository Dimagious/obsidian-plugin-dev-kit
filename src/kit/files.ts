import { readdirSync } from "node:fs";
import path from "node:path";
import { loadText } from "../release/json.js";
import type { WorkflowFile } from "./pins.js";

const WORKFLOWS = ".github/workflows";

/** The workflow files of the plugin, sorted by name. None when the folder does not exist. */
export function loadWorkflows(cwd: string): WorkflowFile[] {
    let names: string[];
    try {
        names = readdirSync(path.join(cwd, WORKFLOWS));
    } catch (error) {
        if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return [];
        }
        throw new Error(`Cannot read ${WORKFLOWS}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return names
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .flatMap((name) => {
            const text = loadText(path.join(cwd, WORKFLOWS, name));
            return text === undefined ? [] : [{ file: `${WORKFLOWS}/${name}`, text }];
        });
}
