const CONTEXT = 20;

export interface Difference {
    /** Byte offset of the first byte that differs (or where the shorter file ends). */
    readonly offset: number;
    readonly line: number;
    readonly column: number;
    readonly first: string;
    readonly second: string;
}

/** The first place two builds of the same file differ, or undefined when the bytes are equal. */
export function firstDifference(a: Uint8Array, b: Uint8Array): Difference | undefined {
    const shared = Math.min(a.length, b.length);
    let offset = 0;
    while (offset < shared && a[offset] === b[offset]) {
        offset++;
    }
    if (offset === shared && a.length === b.length) {
        return undefined;
    }
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset; index++) {
        if (a[index] === 0x0a) {
            line++;
            lineStart = index + 1;
        }
    }
    return { offset, line, column: offset - lineStart + 1, first: around(a, offset), second: around(b, offset) };
}

function around(bytes: Uint8Array, offset: number): string {
    const text = Buffer.from(bytes.subarray(Math.max(0, offset - CONTEXT), offset + CONTEXT)).toString("utf8");
    return JSON.stringify(text);
}

/** What the committed-tree comparison can find, and what it cannot. */
export const LIKELY_CAUSES =
    "Likely causes: a file the build reads that git does not hold (untracked, or ignored by .gitignore), uncommitted changes, an absolute path of this machine in the output (process.cwd, __dirname, import.meta.url, a path in a comment), or a timestamp or random id inlined at build time (Date.now, Math.random, crypto.randomUUID). " +
    "Not compared: the Node and esbuild versions (this machine's node_modules is reused), lockfile drift, line endings on other operating systems. The community directory rebuilds main.js from the tagged commit and compares the bytes.";

/** For the fallback comparison of two builds of the same working tree. */
export const LIKELY_CAUSES_SAME_TREE =
    "Likely causes: a timestamp or random id inlined at build time (Date.now, Math.random, crypto.randomUUID), or a dependency whose output changes between runs. This comparison cannot see files git does not hold or absolute paths: both builds ran in the same folder.";

/** `comparison` says what was compared, for example "the working tree and the committed tree". */
export function describeDifference(file: string, comparison: string, first: Uint8Array, second: Uint8Array, difference: Difference): string {
    return `${file} differs between ${comparison}: first difference at byte ${String(difference.offset)} (line ${String(difference.line)}, column ${String(difference.column)}), ${String(first.length)} and ${String(second.length)} bytes; ${difference.first} against ${difference.second}.`;
}
