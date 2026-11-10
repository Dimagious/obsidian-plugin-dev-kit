import type { ScanConfig } from "../config/types.js";
import { describeGlobProblem } from "./glob.js";

const SCAN_KEYS = ["ignore"];

/** Checks and copies the `scan` section of `opdk.config.mjs`. Every error names the offending key. */
export function validateScanConfig(value: unknown, source: string): ScanConfig {
    if (!isRecord(value)) {
        throw new Error(`${source}: "scan" must be an object.`);
    }
    const unknown = Object.keys(value).filter((key) => !SCAN_KEYS.includes(key));
    if (unknown.length > 0) {
        throw new Error(
            `${source}: unknown key(s) in "scan": ${unknown.join(", ")}. Allowed keys: ${SCAN_KEYS.join(", ")}.`,
        );
    }
    const ignore = Object.hasOwn(value, "ignore") ? value.ignore : undefined;
    if (ignore === undefined) {
        return {};
    }
    if (!Array.isArray(ignore) || !ignore.every((item) => typeof item === "string")) {
        throw new Error(`${source}: "scan.ignore" must be an array of glob strings such as ["site/**"].`);
    }
    const patterns = ignore.map(String);
    for (const pattern of patterns) {
        const problem = describeGlobProblem(pattern);
        if (problem !== undefined) {
            throw new Error(`${source}: "scan.ignore" pattern ${JSON.stringify(pattern)} ${problem}.`);
        }
    }
    return { ignore: patterns };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
