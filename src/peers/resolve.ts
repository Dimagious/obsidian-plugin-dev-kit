import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { VersionReader } from "./versions.js";

/**
 * The real reader: Node's resolution from the plugin's folder (`rootDir`), not from the kit, so a hoisted copy or a
 * nested one is found the way the plugin's own code finds it. A package that is not installed gives `undefined`;
 * anything else that goes wrong (an unreadable or malformed `package.json`, a package that does not export it) throws
 * with the package name, because reporting it as "not installed" would send the plugin author the wrong way.
 */
export function createVersionReader(rootDir: string): VersionReader {
    const require = createRequire(path.join(path.resolve(rootDir), "noop.js"));
    return (name) => {
        let file: string;
        try {
            file = require.resolve(`${name}/package.json`);
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") return undefined;
            throw new Error(`Cannot resolve "${name}/package.json" from ${rootDir}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        const manifest: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
            return manifest.version;
        }
        throw new Error(`${file} has no "version" field. Reinstall "${name}": npm install --save-dev ${name}.`);
    };
}
