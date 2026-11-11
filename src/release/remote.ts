/** A GitHub repository as `gh --repo` names it. */
export interface RepoSlug {
    readonly owner: string;
    readonly repo: string;
}

export const slugText = (slug: RepoSlug): string => `${slug.owner}/${slug.repo}`;

const SCP_LIKE = /^(?:[\w.-]+@)?([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const URL_LIKE = /^(?:https?|ssh|git|git\+ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/**
 * Owner and repository from the URL in `remote.origin.url`: `https://host/o/r(.git)`, `git@host:o/r(.git)`,
 * `ssh://git@host/o/r(.git)`. The host is ignored: `gh` asks github.com, and an SSH alias in the URL still names the
 * right repository. Undefined for anything else (a local path, a URL with more path segments).
 */
export function parseRemoteUrl(url: string): RepoSlug | undefined {
    const text = url.trim();
    const match = URL_LIKE.exec(text) ?? (text.includes("://") ? null : SCP_LIKE.exec(text));
    const owner = match?.[2];
    const repo = match?.[3];
    return owner === undefined || repo === undefined || repo === "" ? undefined : { owner, repo };
}
