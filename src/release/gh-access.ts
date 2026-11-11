import type { RunGit } from "./git.js";
import { GH_INSTALL_HINT, type RunGh } from "./gh.js";
import { asRecord } from "./json.js";
import { StepFailure } from "./publish-state.js";
import { parseRemoteUrl, slugText, type RepoSlug } from "./remote.js";

const CAN_RELEASE = new Set(["WRITE", "MAINTAIN", "ADMIN"]);

export interface GhAccess {
    readonly slug: RepoSlug;
    readonly permission: string;
}

/** The repository `origin` points at, from the configured URL (not the one rewritten by `insteadOf`). */
export async function originSlug(run: RunGit): Promise<RepoSlug> {
    let url: string;
    try {
        url = (await run(["config", "--get", "remote.origin.url"])).trim();
    } catch {
        throw new StepFailure('the repository has no remote called "origin".', "Add it with `git remote add origin <url>`.");
    }
    const slug = parseRemoteUrl(url);
    if (slug === undefined) {
        throw new StepFailure(`origin (${url}) does not look like a GitHub repository URL.`, "The release flow needs https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git.");
    }
    return slug;
}

/**
 * `gh` is installed, signed in, and may write to the repository `origin` points at. One `gh repo view` answers all
 * three; its error text (not signed in, repository not found for this account) is passed on with the fix.
 */
export async function checkGhAccess(run: RunGit, gh: RunGh): Promise<GhAccess> {
    const slug = await originSlug(run);
    const name = slugText(slug);
    let output: string;
    try {
        output = await gh.text(["repo", "view", name, "--json", "nameWithOwner,viewerPermission"]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("gh is not installed")) {
            throw new StepFailure("the GitHub CLI (gh) is not installed.", GH_INSTALL_HINT);
        }
        throw new StepFailure(`gh cannot see ${name}: ${message}`, `Sign in with \`gh auth login\`, or switch to the account that owns ${name} with \`gh auth switch\` (check \`gh auth status\`).`);
    }
    const record = asRecord(JSON.parse(output));
    const permission = typeof record?.viewerPermission === "string" ? record.viewerPermission : "";
    if (!CAN_RELEASE.has(permission)) {
        throw new StepFailure(
            `the signed-in gh account has ${permission === "" ? "no" : permission.toLowerCase()} access to ${name}, and releasing needs write access.`,
            "Switch to an account that can push to the repository with `gh auth switch` (check `gh auth status`).",
        );
    }
    return { slug, permission };
}
