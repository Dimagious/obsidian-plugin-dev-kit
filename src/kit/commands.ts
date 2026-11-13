import type { Command } from "../cli/types.js";
import { createRunGit } from "../release/git.js";
import { parseUpgradeArgs } from "./args.js";
import { createRunNpm, fetchText } from "./runners.js";
import { runKitUpgrade } from "./upgrade.js";

const kitUsage = `Usage: opdk kit upgrade [vX.Y.Z] [--dry-run]

opdk kit upgrade  moves the plugin to a kit release. The kit is pinned in three places, and they must name one
commit: the tag in package.json, the commit the lockfile resolved it to, and the commit in every
"uses: <owner>/obsidian-plugin-dev-kit/.github/workflows/<file>@<sha> # vX.Y.Z" line of .github/workflows/*.yml.
Without a tag it takes the latest vX.Y.Z tag of the kit's repository (git ls-remote --tags, so it needs the
network and no GitHub login). It:
  - resolves the tag to its commit;
  - rewrites the tag in package.json and runs \`npm install\` for that one package, so the lockfile follows (npm
    builds the kit, which takes a minute); if npm fails, package.json and the lockfile are put back (run \`npm ci\`
    if node_modules looks off); without a lockfile npm does not run and node_modules keeps the old kit;
  - rewrites every kit workflow line of the package.json owner to the new commit and sets its "# vX.Y.Z" comment;
  - runs the "kit" step of \`opdk release check\` on the result;
  - prints the kit's CHANGELOG sections between the old and the new version, read from the tag on GitHub (a
    failure to read them is only reported).
It never commits or pushes: review the diff, commit on a branch and open a pull request. Configure Dependabot
to ignore the kit (a bump of one pin alone makes the check fail; see docs/ci.md for the entries) and watch the
kit's releases on GitHub to learn about a new one.

  --dry-run  prints the lines that would change and the changelog, writes nothing, runs no npm; works on a
             dirty tree and outside a git repository. Without it the tree must be clean.

Run \`opdk release check\` to see whether the three places agree (it is part of CI). A plugin that does not use the
kit's workflows only has package.json and the lockfile to compare.
`;

export const kitCommand: Command = {
    name: "kit",
    summary: "Move the plugin to another kit release (package.json, lockfile and workflow pins together)",
    usage: kitUsage,
    async run(args, ctx) {
        const [sub, ...rest] = args;
        if (sub !== "upgrade") {
            throw new Error(`"opdk kit" needs "upgrade", for example "opdk kit upgrade v0.2.0". Run "opdk kit --help".`);
        }
        const parsed = parseUpgradeArgs(rest);
        return runKitUpgrade({
            cwd: ctx.cwd,
            target: parsed.target,
            dryRun: parsed.dryRun,
            reporter: ctx.reporter,
            stdout: (text) => {
                ctx.stdout(text);
            },
            deps: { run: createRunGit(ctx.cwd), npm: createRunNpm(ctx.cwd), fetchText },
        });
    },
};

export const kitCommands: readonly Command[] = [kitCommand];
