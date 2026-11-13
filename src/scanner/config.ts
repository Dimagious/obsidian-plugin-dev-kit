import type { ScanConfig } from "../config/types.js";

/**
 * Checks and copies the `scan` section of `opdk.config.mjs`. It has no keys. `ignore` used to skip tracked files, and
 * a skipped file hid findings that the public scorecard still shows, so it was removed; the error says what to do
 * instead of only naming the key.
 */
export function validateScanConfig(value: unknown, source: string): ScanConfig {
    if (!isRecord(value)) {
        throw new Error(`${source}: "scan" must be an object.`);
    }
    if (Object.hasOwn(value, "ignore")) {
        throw new Error(
            `${source}: "scan.ignore" was removed. The community scanner reads every tracked stylesheet and every script a tsconfig covers, so a path listed there still lowers the scorecard while \`opdk scan\` stayed silent. Delete the key and fix what \`opdk scan\` reports, or untrack the file.`,
        );
    }
    const unknown = Object.keys(value);
    if (unknown.length > 0) {
        throw new Error(`${source}: unknown key(s) in "scan": ${unknown.join(", ")}. The "scan" section has no keys.`);
    }
    return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
