/** The parts of a release check, in the order they run and print. */
export const CHECK_GROUPS = ["versions", "versions.json", "manifest", "changelog", "kit", "build", "assets", "reproducible", "api"] as const;

export type CheckGroup = (typeof CHECK_GROUPS)[number];

/** One thing a release check found. Errors fail the check, warnings print as `!` lines and do not. */
export interface Problem {
    readonly group: CheckGroup;
    readonly severity: "error" | "warning";
    /** What is wrong, with the values involved. */
    readonly message: string;
    /** What to do about it. */
    readonly hint?: string;
    /** Extra lines under the problem, such as esbuild's messages. */
    readonly details?: readonly string[];
}

export function errorProblem(group: CheckGroup, message: string, hint?: string, details?: readonly string[]): Problem {
    return { group, severity: "error", message, ...(hint !== undefined && { hint }), ...(details !== undefined && { details }) };
}

export function warningProblem(group: CheckGroup, message: string, hint?: string): Problem {
    return { group, severity: "warning", message, ...(hint !== undefined && { hint }) };
}

/** What one group found, plus the sentence that says it passed. */
export interface GroupResult {
    readonly group: CheckGroup;
    /** Printed after a `✓` when the group has no errors. */
    readonly passed: string;
    readonly problems: readonly Problem[];
}

export function hasErrors(problems: readonly Problem[]): boolean {
    return problems.some((problem) => problem.severity === "error");
}
