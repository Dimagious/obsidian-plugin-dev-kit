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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
