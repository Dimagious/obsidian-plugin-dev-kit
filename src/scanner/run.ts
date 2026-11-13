import "./use-typescript-six.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { Manifest } from "../config/types.js";
import { checkCode, isShippedSource, type SourceFile } from "./code-checks.js";
import { checkCss } from "./css-check.js";
import { eslintMismatchWarning } from "./eslint-nesting.js";
import { findingsOf, formatFinding, SCAN_CHECKS, type Finding, type ScanCheck } from "./findings.js";
import { listTrackedFiles } from "./git-files.js";
import { runScannerLint } from "./lint.js";
import { checkManifestDescription } from "./meta-checks.js";
import { MIRRORED_OBSIDIANMD_VERSION } from "./scanner-config.js";
import { describeTypescriptGap, readTypescriptNextToTypescriptEslint } from "./typescript-six.js";
import { scanTypescript } from "./use-typescript-six.js";

export interface ScanInput {
    readonly cwd: string;
    readonly manifest: Manifest;
    readonly reporter: Reporter;
    /** Reads the ESLint version that `eslint-plugin-obsidianmd` resolves. Tests inject it; the default reads the install. */
    readonly readNestedEslintVersion?: () => string;
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

function readSources(cwd: string, files: readonly string[]): SourceFile[] {
    return files.map((file) => ({ path: file, text: readFileSync(path.join(cwd, file), "utf8") }));
}

/** What each check looked at, for the line that says it passed. */
type Scope = Readonly<Record<ScanCheck, string>>;

/**
 * Prints one check: a `✓` line when it found nothing, otherwise the findings under a `✗` line (stderr). Advisory
 * findings print as `!` lines and do not count. Returns the number of findings that fail the scan.
 */
export function reportCheck(check: ScanCheck, findings: readonly Finding[], scope: string, reporter: Reporter): number {
    const own = findingsOf(findings, check);
    const failing = own.filter((finding) => finding.advisory !== true);
    for (const finding of own.filter((candidate) => candidate.advisory === true)) {
        reporter.warn(check, formatFinding(finding));
    }
    if (failing.length === 0) {
        reporter.success(check, `0 findings (${scope})`);
    } else {
        reporter.failure(check, `${plural(failing.length, "finding")} (${scope}):`, { details: failing.map(formatFinding) });
    }
    return failing.length;
}

/** `opdk scan`: the scanner's ESLint pass, the CSS check and the source checks over the tracked files. Returns the exit code. */
export async function runScan({ cwd, manifest, reporter, readNestedEslintVersion }: ScanInput): Promise<number> {
    const files = await listTrackedFiles(cwd);
    if (files.length === 0) {
        reporter.failure("scan", `${manifest.id}: no files to scan (git tracks none in this folder).`, {
            hint: "Run `git add` for the plugin's files, or run opdk from the plugin repository.",
        });
        return 1;
    }
    reporter.info("scan", `${manifest.id}: ${plural(files.length, "tracked file")}`);

    const cssFiles = readSources(cwd, files.filter((file) => file.endsWith(".css")));
    const codeFiles = readSources(cwd, files.filter(isShippedSource));
    const mismatch = eslintMismatchWarning(undefined, readNestedEslintVersion);
    if (mismatch !== undefined) {
        reporter.warn("lint", mismatch);
    }
    if (!scanTypescript.forced) {
        const gap = describeTypescriptGap(scanTypescript, readTypescriptNextToTypescriptEslint());
        if (gap !== undefined) {
            reporter.warn("lint", gap);
        }
    }
    const lint = await runScannerLint(cwd, files);

    const findings: Finding[] = [
        ...lint.findings,
        ...(await checkCss(cssFiles)),
        ...checkCode(codeFiles),
        ...checkManifestDescription(manifest),
    ];
    const scope: Scope = {
        lint: `${plural(lint.linted, "file")}, eslint-plugin-obsidianmd ${MIRRORED_OBSIDIANMD_VERSION}, typescript ${scanTypescript.version}${lint.untyped > 0 ? `, ${String(lint.untyped)} outside every tsconfig, advisory` : ""}`,
        css: plural(cssFiles.length, "file"),
        code: plural(codeFiles.length, "file"),
        meta: "manifest.json",
    };
    const failing = SCAN_CHECKS.reduce((total, check) => total + reportCheck(check, findings, scope[check], reporter), 0);
    if (failing > 0) {
        reporter.failure("scan", `${manifest.id}: ${plural(failing, "finding")}, each one lowers the community scorecard.`, {
            hint: "Fix them and rerun `opdk scan`. Each line reads file:line  rule  message.",
        });
        return 1;
    }
    reporter.success("scan", `${manifest.id}: 0 findings in ${plural(files.length, "tracked file")}`);
    return 0;
}
