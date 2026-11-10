/**
 * The glob subset `scan.ignore` accepts. Patterns match the whole path from the plugin root, with `/` separators:
 * `*` is any run of characters except `/`, `?` is one character except `/`, `**` is any run including `/`
 * (`**\/` also matches no folder at all). Braces, brackets and `!` are rejected rather than half-supported, so a
 * pattern never silently matches less than it says.
 */

const UNSUPPORTED = /[{}[\]!\\]/;

/** Returns what is wrong with a pattern, or `undefined` when it is usable. */
export function describeGlobProblem(pattern: string): string | undefined {
    if (pattern === "") {
        return "is empty";
    }
    if (UNSUPPORTED.test(pattern)) {
        return "uses {}, [], ! or a backslash, which are not supported (only *, ** and ? are)";
    }
    if (pattern.startsWith("/") || pattern.startsWith("./")) {
        return "must be relative to the plugin root, without a leading / or ./";
    }
    if (pattern.split("/").includes("..")) {
        return 'must not contain ".."';
    }
    return undefined;
}

function toRegExp(pattern: string): RegExp {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern.charAt(i);
        if (char === "*") {
            if (pattern.charAt(i + 1) === "*") {
                const slash = pattern.charAt(i + 2) === "/";
                source += slash ? "(?:.*/)?" : ".*";
                i += slash ? 2 : 1;
            } else {
                source += "[^/]*";
            }
        } else if (char === "?") {
            source += "[^/]";
        } else {
            source += char.replace(/[.+^$()|]/g, "\\$&");
        }
    }
    return new RegExp(`^${source}$`);
}

/** A predicate for repo-relative paths with `/` separators. Throws on a pattern `describeGlobProblem` rejects. */
export function createIgnoreMatcher(patterns: readonly string[]): (relativePath: string) => boolean {
    const expressions = patterns.map((pattern) => {
        const problem = describeGlobProblem(pattern);
        if (problem !== undefined) {
            throw new Error(`Ignore pattern ${JSON.stringify(pattern)} ${problem}.`);
        }
        return toRegExp(pattern);
    });
    return (relativePath) => expressions.some((expression) => expression.test(relativePath));
}
