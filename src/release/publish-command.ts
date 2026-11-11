import path from "node:path";
import { readFileSync } from "node:fs";
import type { Reporter } from "../cli/reporter.js";
import { resolveBuild } from "../build/options.js";
import type { OpdkConfig } from "../config/types.js";
import type { PushOptions } from "./args.js";
import { createRunGh } from "./gh.js";
import { checkGhAccess } from "./gh-access.js";
import { createRunGit } from "./git.js";
import type { InterruptHooks } from "./interrupt.js";
import { asRecord } from "./json.js";
import { DEFAULT_APPEAR_MS, DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MINUTES, runPublish, type PublishInput } from "./publish.js";
import { releaseNotes } from "./changelog.js";
import type { PushFlow } from "./release.js";
import { DEFAULT_CHANGELOG, loadProjectFiles, valueOf } from "./project-files.js";

export interface PublishContext {
    readonly cwd: string;
    readonly config: OpdkConfig;
    readonly reporter: Reporter;
    readonly pushing: PushOptions;
    readonly interrupt?: InterruptHooks;
}

function publishInput(context: PublishContext, version: string): PublishInput {
    const { cwd, config } = context;
    const run = createRunGit(cwd);
    return {
        version,
        reporter: context.reporter,
        run,
        gh: createRunGh(cwd),
        defaultBranch: config.release?.defaultBranch,
        buildTagged: async (cleanups) => {
            // Loaded here: the build pulls in esbuild.
            const { buildTagged } = await import("./build-tagged.js");
            return buildTagged({ cwd, run, version, build: resolveBuild(config.build), cleanups });
        },
        zip: context.pushing.zip,
        timeoutMs: (context.pushing.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
        appearMs: DEFAULT_APPEAR_MS,
        pollMs: DEFAULT_POLL_MS,
        clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
        ...(context.interrupt !== undefined && { interrupt: context.interrupt }),
    };
}

/** The push flow `opdk release <bump>` runs after the tag. */
export function createPushFlow(context: PublishContext): PushFlow {
    return {
        ready: async () => {
            await checkGhAccess(createRunGit(context.cwd), createRunGh(context.cwd));
        },
        publish: (version) => runPublish(publishInput(context, version)),
    };
}

function manifestVersion(cwd: string): string {
    const files = loadProjectFiles(cwd);
    const version = asRecord(valueOf(files.manifest))?.version;
    if (typeof version !== "string") {
        throw new Error("manifest.json is missing, not valid or has no version. Run opdk from the plugin root, or pass the version: opdk release publish X.Y.Z");
    }
    return version;
}

/** `opdk release publish [X.Y.Z]`: continues the push flow from an existing local tag. */
export function runPublishCommand(context: PublishContext, version: string | undefined): Promise<number> {
    return runPublish(publishInput(context, version ?? manifestVersion(context.cwd)));
}

/** `opdk release notes [X.Y.Z]`: the body of the changelog section, ready to print. Throws a message with the fix. */
export function changelogNotes(cwd: string, config: OpdkConfig, version: string | undefined): string {
    const file = config.release?.changelog ?? DEFAULT_CHANGELOG;
    let text: string;
    try {
        text = readFileSync(path.join(cwd, file), "utf8");
    } catch (error) {
        throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}. Run opdk from the plugin root, or set release.changelog in opdk.config.mjs.`, { cause: error });
    }
    const wanted = version ?? manifestVersion(cwd);
    const notes = releaseNotes(text, wanted);
    if (notes === undefined) {
        throw new Error(`${file} has no "## [${wanted}]" section. Move the entries of "## [Unreleased]" under it, or run \`opdk release <patch|minor|major>\`.`);
    }
    if (notes === "") {
        throw new Error(`The "## [${wanted}]" section of ${file} is empty. Say what changed in this version.`);
    }
    return `${notes}\n`;
}
