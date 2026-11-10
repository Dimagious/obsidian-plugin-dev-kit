import { readFileSync } from "node:fs";

/**
 * Reads the kit's own version. The path is resolved from the module file, not from cwd,
 * so it works the same from src/cli (tests) and dist/cli (installed).
 */
export function readKitVersion(fromUrl: string): string {
    const packageUrl = new URL("../../package.json", fromUrl);
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(packageUrl, "utf8"));
    } catch (error) {
        throw new Error(`Cannot read the kit's package.json at ${packageUrl.href}: ${errorMessage(error)}`, {
            cause: error,
        });
    }
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
    }
    throw new Error(`The kit's package.json at ${packageUrl.href} has no string "version".`);
}

/**
 * Reads the short git commit `scripts/write-build-info.mjs` wrote to `dist/build-info.json` at build time.
 * Returns undefined when the file is missing (running from `src/`, or a build without a git checkout) or holds
 * no commit; a file that is not valid JSON is an error, because only the build writes it.
 */
export function readKitCommit(fromUrl: string): string | undefined {
    const infoUrl = new URL("../build-info.json", fromUrl);
    let text: string;
    try {
        text = readFileSync(infoUrl, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw new Error(`Cannot read the kit's build info at ${infoUrl.href}: ${errorMessage(error)}`, { cause: error });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`The kit's build info at ${infoUrl.href} is not valid JSON: ${errorMessage(error)}. Rebuild the kit with \`npm run build\`.`, {
            cause: error,
        });
    }
    if (typeof parsed === "object" && parsed !== null && "commit" in parsed && typeof parsed.commit === "string" && parsed.commit !== "") {
        return parsed.commit;
    }
    return undefined;
}

/** `0.0.0 (3613c4f)` when the commit is known, else just the version. */
export function describeKitVersion(fromUrl: string): string {
    const version = readKitVersion(fromUrl);
    const commit = readKitCommit(fromUrl);
    return commit === undefined ? version : `${version} (${commit})`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
