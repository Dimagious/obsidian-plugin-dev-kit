import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { TaggedBuild } from "./build-tagged.js";
import type { RunGh } from "./gh.js";
import type { TagFacts } from "./publish-git.js";
import { StepFailure } from "./publish-state.js";
import { slugText, type RepoSlug } from "./remote.js";
import { assetProblems, expectedAssets, findRelease, zipAssetName, type ReleaseInfo } from "./release-assets.js";
import { describeDifference, firstDifference } from "./reproducible.js";

const RELEASES_PAGE = (repo: string): string => `repos/${repo}/releases?per_page=50`;

/** The release of a tag, drafts included (`/releases/tags/<tag>` does not return a draft). Undefined when there is none. */
export async function fetchRelease(gh: RunGh, slug: RepoSlug, version: string): Promise<ReleaseInfo | undefined> {
    return findRelease(await gh.text(["api", RELEASES_PAGE(slugText(slug))]), version);
}

export interface VerifyInput {
    readonly gh: RunGh;
    readonly slug: RepoSlug;
    readonly facts: TagFacts;
    readonly release: ReleaseInfo;
    readonly local: TaggedBuild;
    readonly zip: boolean;
    /** An empty folder for the downloaded assets. */
    readonly dir: string;
    readonly reporter: Reporter;
}

/**
 * The workflow that signs the attestations: the kit's reusable release workflow, not the plugin's caller workflow.
 * The signing certificate of a job that runs a reusable workflow names that workflow, so `gh attestation verify --repo`
 * alone refuses it ("verifying with issuer sigstore.dev", with no reason); the signer has to be named.
 */
export const KIT_RELEASE_WORKFLOW = "Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml";

const FIX = (version: string): string =>
    `Nothing was published. Do not edit the assets by hand: delete the draft on GitHub, fix the cause, and release a new patch version (the tag ${version} stays and is never moved).`;

/**
 * Checks a release before it is made public: the right asset names, the bytes equal to a build of the tagged
 * commit made here (and the manifest equal to the committed one), and an attestation for each attested file. Throws a
 * `StepFailure` for the first kind of problem; the downloads are left in `dir` for the caller to remove.
 */
export async function verifyRelease(input: VerifyInput): Promise<void> {
    const { gh, slug, facts, release, local, reporter } = input;
    const repo = slugText(slug);
    const expected = expectedAssets({ hasCss: local.css !== undefined, zipName: input.zip ? zipAssetName(facts.pluginId, facts.version) : undefined });
    const problems = assetProblems(release, expected);
    if (problems.length > 0) {
        throw new StepFailure(`the release ${facts.version} is not what Obsidian needs: ${release.url}`, FIX(facts.version), problems);
    }
    reporter.success("verify", `assets: ${expected.names.join(", ")}`);

    mkdirSync(input.dir, { recursive: true });
    const downloaded = new Map<string, Buffer>();
    for (const name of expected.names) {
        const asset = release.assets.find((candidate) => candidate.name === name);
        if (asset === undefined) {
            continue;
        }
        const bytes = await gh.bytes(["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${String(asset.id)}`]);
        writeFileSync(path.join(input.dir, name), bytes);
        downloaded.set(name, bytes);
    }

    const comparison = `the release asset and a build of the tag ${facts.version} (commit ${local.commit})`;
    const pairs: [string, Buffer | undefined][] = [["main.js", local.mainJs], ["styles.css", local.css], ["manifest.json", local.manifest]];
    const differences: string[] = [];
    for (const [name, mine] of pairs) {
        const theirs = downloaded.get(name);
        const difference = mine === undefined || theirs === undefined ? undefined : firstDifference(mine, theirs);
        if (mine !== undefined && theirs !== undefined && difference !== undefined) {
            differences.push(describeDifference(name, comparison, mine, theirs, difference));
        }
    }
    if (differences.length > 0) {
        throw new StepFailure(
            `the release assets are not the bytes of the tagged commit: ${release.url}`,
            `${FIX(facts.version)} A different Node or dependency version in CI, or a build that is not reproducible, are the usual causes (\`opdk release check\` builds the committed tree twice).`,
            differences,
        );
    }
    reporter.success("verify", `${expected.attested.join(", ")} equal a local build of ${facts.version} (${local.commit}) byte for byte`);

    for (const name of expected.attested) {
        try {
            await gh.text(["attestation", "verify", path.join(input.dir, name), "--repo", repo, "--signer-workflow", KIT_RELEASE_WORKFLOW, "--source-ref", `refs/tags/${facts.version}`, "--source-digest", facts.commit]);
        } catch (error) {
            throw new StepFailure(`the attestation of ${name} does not verify: ${error instanceof Error ? error.message : String(error)}`, `${FIX(facts.version)} The assets must be attested by ${KIT_RELEASE_WORKFLOW} for ${repo} at the tag ${facts.version}: the plugin's workflow must call it, and an old gh may not verify new attestations (update it).`);
        }
    }
    reporter.success("verify", `attestations: ${expected.attested.join(", ")} verified for ${repo} at ${facts.version}`);
}
