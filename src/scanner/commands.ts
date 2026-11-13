import type { Command } from "../cli/types.js";
import { loadConfig } from "../config/load-config.js";
import { readManifest } from "../config/manifest.js";

const scanUsage = `Usage: opdk scan

Runs the community plugin scanner's ESLint configuration, plus checks that reproduce
its CSS, source and manifest findings, over the files git tracks in the plugin
folder. The scanner's ESLint warnings count as findings and fail the scan; advisory
"!" lines (ts-suppression) do not:
  lint  the scanner's own ESLint configuration (eslint-plugin-obsidianmd)
  css   every .css file: !important, :has, features Obsidian's Chromium lacks
  code  checks the ESLint rules do not cover (domain assembly from joined strings)
  meta  manifest.json description must not start with the plugin name

Needs a git repository: build output (main.js, coverage/) is untracked, so the
scanner never sees it and neither does this. Stage new files with git add first.
Findings print as file:line  rule  message. Exit 1 on any failing finding.

The plugin name comes from manifest.json. There are no settings: every file the scanner reads counts.
`;

export const scanCommand: Command = {
    name: "scan",
    summary: "Run the community plugin scanner's checks over the tracked files",
    usage: scanUsage,
    async run(args, ctx) {
        if (args.length > 0) {
            throw new Error(`"opdk scan" takes no arguments, got "${args.join(" ")}". Run "opdk scan --help".`);
        }
        const manifest = readManifest(ctx.cwd);
        await loadConfig(ctx.cwd);
        // Loaded here, not at the top: the scan pulls in ESLint, obsidianmd, typescript-eslint and doiuse, and
        // obsidianmd reads manifest.json from the current directory at import. Every other command, and
        // `opdk --help`, must not pay for that or fail on it.
        // The scan's ESLint plugins load `typescript` at import: a missing one is reported before that import.
        const { missingTypescriptPreflight } = await import("./typescript-gate.js");
        const missing = missingTypescriptPreflight(manifest.id, ctx.reporter);
        if (missing !== undefined) {
            return missing;
        }
        const { runScan } = await import("./run.js");
        return runScan({ cwd: ctx.cwd, manifest, reporter: ctx.reporter });
    },
};

export const scanCommands: readonly Command[] = [scanCommand];
