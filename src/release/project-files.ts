import path from "node:path";
import { loadJson, loadText, type Loaded } from "./json.js";

/** The files a release reads, as found in the plugin folder. */
export interface ProjectFiles {
    readonly packageJson: Loaded;
    readonly lock: Loaded;
    readonly manifest: Loaded;
    readonly versions: Loaded;
    /** Text of the changelog, undefined when the file does not exist. */
    readonly changelog: string | undefined;
}

export const DEFAULT_CHANGELOG = "CHANGELOG.md";

export function loadProjectFiles(cwd: string, changelog: string = DEFAULT_CHANGELOG): ProjectFiles {
    return {
        packageJson: loadJson(path.join(cwd, "package.json")),
        lock: loadJson(path.join(cwd, "package-lock.json")),
        manifest: loadJson(path.join(cwd, "manifest.json")),
        versions: loadJson(path.join(cwd, "versions.json")),
        changelog: loadText(path.join(cwd, changelog)),
    };
}

/** The parsed value of a file that was read, else undefined. */
export function valueOf(loaded: Loaded): unknown {
    return loaded.kind === "ok" ? loaded.value : undefined;
}
