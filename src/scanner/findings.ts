/**
 * The scan checks, in the order they run and print. The names are the reporter's step column, so they stay within
 * its width.
 */
export const SCAN_CHECKS = ["lint", "css", "code", "meta"] as const;

export type ScanCheck = (typeof SCAN_CHECKS)[number];

export interface Finding {
    readonly check: ScanCheck;
    /** Path relative to the plugin root, with `/` separators. */
    readonly file: string;
    /** 1-based. */
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    /** Printed as a warning and does not fail the scan. */
    readonly advisory?: boolean;
}

/** `file:line  rule  message`, the one layout every finding prints in. */
export function formatFinding(finding: Finding): string {
    return `${finding.file}:${String(finding.line)}  ${finding.rule}  ${finding.message}`;
}

/** Stable order: by file, then line, then rule, so two runs print the same text. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
    return [...findings].sort(
        (a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.rule, b.rule) || compare(a.message, b.message),
    );
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** The findings of one check, sorted. */
export function findingsOf(findings: readonly Finding[], check: ScanCheck): Finding[] {
    return sortFindings(findings.filter((finding) => finding.check === check));
}
