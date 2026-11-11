import type { Command } from "../cli/types.js";
import { loadConfig } from "../config/load-config.js";
import { parseReleaseArgs } from "./args.js";
import { runReleaseCheck } from "./check.js";
import { createRunGit } from "./git.js";
import { changelogNotes, createPushFlow, runPublishCommand } from "./publish-command.js";
import { runRelease } from "./release.js";
import { resolveTag } from "./version-rules.js";

const releaseUsage = `Usage: opdk release check [--tag <name>] [--no-build] [--no-reproducible] [--no-api]
       opdk release <patch|minor|major|X.Y.Z> [--dry-run] [--no-push] [--timeout <minutes>] [--zip]
                    [--no-build] [--no-reproducible] [--no-api]
       opdk release publish [X.Y.Z] [--timeout <minutes>] [--zip]
       opdk release notes [X.Y.Z]

opdk release check  (for CI and before a release) fails with exit 1, one line per problem and what to do about it:
  versions       manifest.json, package.json and package-lock.json (both version fields) hold the same
                 x.y.z version (no "v", no pre-release); with --tag <name>, or GITHUB_REF_NAME when
                 GITHUB_REF_TYPE=tag, the tag is that version
  versions.json  a file that exists and is an object; the current version maps to the manifest's minAppVersion;
                 minAppVersion never goes down as versions go up (errors). A key or value that is not a version
                 is a warning, as in the official action.
  manifest       the rules of the official obsidianmd/obsidian-workflows action: required fields, id, name
                 and description rules, author without email or URL, HTTPS URLs, isDesktopOnly a boolean,
                 version not 0.0.0, minAppVersion a version (warnings print as "!" and do not fail).
                 Differences from the action: author, minAppVersion and isDesktopOnly are required (the
                 action only recommends them); a banned word in the id is a warning, in the name an error;
                 helpUrl is accepted and its URL checked; authorUrl, helpUrl and fundingUrl of the wrong type
                 are errors; the action's check that authorUrl is not the plugin's own repository is covered
                 by the general warning that authorUrl links to a repository.
  changelog      CHANGELOG.md has a "## [X.Y.Z]" section with at least one entry
  build          a production build into a temp folder (your main.js and styles.css are not touched), the
                 Node-only bundle check. Warns when package.json scripts.build (else build:plugin, else
                 compile: the order the community directory uses) does not run \`opdk build\`, because the
                 directory rebuilds main.js with that script
  assets         main.js is produced, styles.css when the plugin has CSS, the manifest asset is the root one
  reproducible   builds the working tree, then builds the committed tree (git archive HEAD, extracted to
                 another temp folder, with the plugin's node_modules linked in) and compares main.js and
                 styles.css byte for byte. It catches inputs git does not hold (untracked or ignored files,
                 the build fails there) and absolute paths of this machine in the output. It does not compare
                 the Node or esbuild version (this machine's node_modules is reused), lockfile drift or line
                 endings on other operating systems. With uncommitted changes the committed tree is what is
                 compared and the output says so; outside a git repository, or before the first commit, it
                 builds the working tree twice and warns that this proves much less, and so do pnpm and
                 Yarn PnP installs (two builds of the working tree). git archive applies export-ignore from
                 .gitattributes, and Git LFS files are pointer text in it, so a build input tracked by LFS
                 makes the comparison differ. On a mismatch it names the first differing offset and the
                 likely causes
  api            minAppVersion against the API the code calls (obsidianmd/no-unsupported-api, type-aware;
                 needs \`npm ci\` first). It lints the files esbuild puts into main.js (not node_modules);
                 a shipped file that no tsconfig covers is an error. Blind spot: the rule reads @since tags
                 from obsidian.d.ts through the TypeScript program, so it reports nothing when the program
                 does not contain the real one (for example a tsconfig "paths" entry pointing obsidian at a
                 stub), and the check cannot tell. \`opdk scan\` does not change.

  Skipping: --no-build skips build, assets and reproducible (a quick CI step); --no-reproducible builds
  once; --no-api skips the API check. The version, versions.json, manifest and changelog checks always run.

opdk release <patch|minor|major|X.Y.Z>  cuts a release. Preflight: inside a git repository, clean
  tree, on the default branch (origin/HEAD, or release.defaultBranch), not behind origin (it fetches), the tag absent locally and on origin,
  "## [Unreleased]" in the changelog with entries. Then it:
  - sets the version in package.json, package-lock.json and manifest.json, adds it to versions.json (an existing
    entry is never rewritten) and moves the [Unreleased] entries under "## [X.Y.Z] - YYYY-MM-DD", leaving an
    empty [Unreleased] (the compare links at the bottom are updated when the file has them);
  - runs the release check on the result; when it fails, or on Ctrl+C, the files are restored, the temp
    folders removed and nothing is committed (Ctrl+C exits with 130);
  - commits "chore(release): X.Y.Z" and creates the annotated tag X.Y.Z;
  - then the push flow (below), unless --no-push, which stops at the local tag.
  --dry-run runs everything up to the commit, prints the diff, writes nothing to git and restores the files.

The push flow (also \`opdk release publish [X.Y.Z]\`, which starts from an existing local tag and continues
after any stop; every step checks what is already done). It needs the GitHub CLI, signed in with write access
to the repository origin points at (checked before anything is bumped), and a workflow in the plugin that
runs on tag pushes and calls the kit's release workflow: uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@<full
commit SHA of the kit>. Call it, do not copy it: the attestations are checked against the kit's file. publish
without a version uses the version in manifest.json; --dry-run never reaches GitHub, so it skips the gh check. The
plugin's build script (build, else build:plugin, else compile) must run \`opdk build\`: the assets are compared
with an \`opdk build\` of the tag, and a plugin that builds some other way fails that comparison after the tag is
already pushed. It:
  1. pushes only the tag (git push origin refs/tags/X.Y.Z); never the branch yet, never with force;
  2. waits for the run of the kit's release workflow on that commit (other workflows on the same push, such as
     Pages, are ignored; a progress line when its state changes, 20 minutes by default, --timeout <minutes> to
     change); when it fails it prints the run URL and stops, the tag stays. If no such run starts within 3
     minutes, the plugin's tag workflow does not call the kit's release.yml;
  3. checks the draft release: a draft, main.js and manifest.json, styles.css only if the plugin has CSS, no
     other asset (--zip also expects <id>-<version>.zip); notes equal to the CHANGELOG section at the tag;
     downloads the assets and compares them byte for byte
     with a build of the tagged commit made here (the committed-tree build of the reproducible check) and
     with the committed manifest.json (the zip is checked for presence and size only); runs gh attestation
     verify on each attested file for the repository, the tag, the tagged commit and the signer, which must be
     the kit's release.yml at any ref (--cert-identity-regex, anchored); two releases for one tag stop it;
  4. publishes it (gh release edit --draft=false --latest) and confirms it is public and the latest release;
  5. pushes the release commit to the default branch (no force; later local commits stay local, and nothing is
     pushed when origin already holds the commit). When origin rejects it the release is already public: the
     message says to merge origin's commits without rewriting the release commit;
  6. prints the release and run URLs.
  Every stop, and Ctrl+C (exit 130), prints what is on origin and the command to resume:
  opdk release publish X.Y.Z. A stop whose hint says to release a new version prints opdk release patch instead.
  A failed workflow is fixed by a new patch version, or re-run on GitHub (delete a draft it left behind first)
  and resumed; nothing is ever moved or deleted by opdk.

opdk release notes [X.Y.Z]  prints the body of the "## [X.Y.Z]" section of the changelog (X.Y.Z defaults to
  the manifest version): the release workflow uses it for the release notes. Exit 1 when the section is
  missing or empty.

Settings come from opdk.config.mjs ("release" section: changelog, defaultBranch; "build" section for the build).
`;

export const releaseCommand: Command = {
    name: "release",
    summary: "Check that a commit can be released, cut a release, publish it, or print its changelog notes",
    usage: releaseUsage,
    async run(args, ctx) {
        const parsed = parseReleaseArgs(args);
        const config = await loadConfig(ctx.cwd);
        const onInterrupt = ctx.onInterrupt?.bind(ctx);
        // The CLI exits through the exit code; Ctrl+C has no return path, so the listener ends the process itself.
        const interrupt = onInterrupt === undefined ? undefined : { onInterrupt, exit: (code: number): void => process.exit(code) };
        if (parsed.mode === "check") {
            return runReleaseCheck({ cwd: ctx.cwd, config, tag: resolveTag(parsed.tag, ctx.env), flags: parsed.flags, reporter: ctx.reporter, ...(interrupt !== undefined && { interrupt }) });
        }
        if (parsed.mode === "notes") {
            ctx.stdout(changelogNotes(ctx.cwd, config, parsed.version));
            return 0;
        }
        const push = { cwd: ctx.cwd, config, reporter: ctx.reporter, pushing: parsed.pushing, ...(interrupt !== undefined && { interrupt }) };
        if (parsed.mode === "publish") {
            return runPublishCommand(push, parsed.version);
        }
        return runRelease({
            cwd: ctx.cwd,
            spec: parsed.spec,
            dryRun: parsed.dryRun,
            flags: parsed.flags,
            config,
            reporter: ctx.reporter,
            stdout: (text) => {
                ctx.stdout(text);
            },
            run: createRunGit(ctx.cwd),
            ...(interrupt !== undefined && { interrupt }),
            now: () => new Date(),
            ...(parsed.pushing.push && { push: createPushFlow(push) }),
        });
    },
};

export const releaseCommands: readonly Command[] = [releaseCommand];
