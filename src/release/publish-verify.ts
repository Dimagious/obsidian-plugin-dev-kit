import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { TaggedBuild } from "./build-tagged.js";
import type { RunGh } from "./gh.js";
import type { TagFacts } from "./publish-git.js";
import { StepFailure } from "./publish-state.js";
import { slugText, type RepoSlug } from "./remote.js";
import { assetProblems, expectedAssets, releasesOfTag, zipAssetName, type ReleaseInfo } from "./release-assets.js";
import { KIT_WORKFLOW_PATH } from "./workflow-run.js";
import { describeDifference, firstDifference } from "./reproducible.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/**
 * The release of a tag, drafts included (`/releases/tags/<tag>` does not return a draft). Undefined when there is none.
 * Every page of the list is read, and a tag with two releases (a re-run of a failed workflow makes a second draft) stops
 * the flow: verifying and publishing one of them would be a guess.
 */
export async function fetchRelease(gh: RunGh, slug: RepoSlug, version: string): Promise<ReleaseInfo | undefined> {
    const repo = slugText(slug);
    const found: ReleaseInfo[] = [];
    let finished = false;
    for (let page = 1; page <= MAX_PAGES && !finished; page++) {
        const result = releasesOfTag(await gh.text(["api", `repos/${repo}/releases?per_page=${String(PAGE_SIZE)}&page=${String(page)}`]), version);
        found.push(...result.found);
        finished = result.count < PAGE_SIZE;
    }
    if (!finished) {
        throw new StepFailure(`${repo} has more than ${String(MAX_PAGES * PAGE_SIZE)} releases, and the release ${version} was not among the first ones.`, "Look for the release by hand on GitHub; opdk does not read further.");
    }
    if (found.length > 1) {
        throw new StepFailure(
            `GitHub has ${String(found.length)} releases for the tag ${version}: ${found.map((release) => release.url).join(", ")}`,
            `Keep the one you trust and delete the other(s) on GitHub (a re-run of a failed workflow creates a second draft), then run \`opdk release publish ${version}\`.`,
        );
    }
    return found[0];
}

export interface VerifyInput {
    readonly gh: RunGh;
    readonly slug: RepoSlug;
    readonly facts: TagFacts;
    readonly release: ReleaseInfo;
    readonly local: TaggedBuild;
    /** The changelog notes of the tag, which the draft's body must equal. */
    readonly notes: string;
    readonly zip: boolean;
    /** An empty folder for the downloaded assets. */
    readonly dir: string;
    readonly reporter: Reporter;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The signer of the attestations: the kit's reusable release workflow, not the plugin's caller workflow. The signing
 * certificate of a job that runs a reusable workflow names that workflow, so `gh attestation verify --repo` alone
 * refuses it ("verifying with issuer sigstore.dev", with no reason); the signer has to be named. The regex is anchored
 * at both ends of the prefix (`https://github.com/` and the `@` before the ref), so `release.yml-copy` or another
 * owner's `obsidian-plugin-dev-kit` does not match, and any ref of the kit (a tag or a full SHA) does.
 */
export const KIT_SIGNER_REGEX = `^https://github\\.com/${escapeRegex(KIT_WORKFLOW_PATH)}@`;

const FIX = (version: string, release: ReleaseInfo): string =>
    release.draft
        ? `Nothing was published. Do not edit the assets by hand: delete the draft on GitHub, fix the cause, and release a new patch version with \`opdk release patch\` (the tag ${version} stays and is never moved).`
        : `The release ${version} is already public, so this flow changes nothing. Do not delete it: look at what differs, and if the assets are wrong, release a new patch version with \`opdk release patch\`.`;

/** Reads the notes of the tag; a failure is a stop that resuming would not fix (the tag's changelog is what it is). */
export async function tagNotes(read: (version: string) => Promise<string>, version: string): Promise<string> {
    try {
        return await read(version);
    } catch (error) {
        throw new StepFailure(`cannot read the release notes of the tag ${version}: ${error instanceof Error ? error.message : String(error)}`, "The workflow takes the release notes from the changelog at the tag, and so does this check. The tag is never moved: release a new patch version with `opdk release patch`.", [], false);
    }
}

const NOTES_SHOWN = 300;
const trimNotes = (text: string): string => text.replace(/\s+$/, "");
const shortNotes = (text: string): string => {
    const trimmed = trimNotes(text);
    return trimmed.length > NOTES_SHOWN ? `${trimmed.slice(0, NOTES_SHOWN)}... (${String(trimmed.length)} characters)` : trimmed;
};

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
        throw new StepFailure(`the release ${facts.version} is not what Obsidian needs: ${release.url}`, FIX(facts.version, release), problems, false);
    }
    reporter.success("verify", `assets: ${expected.names.join(", ")}`);

    // The notes travel between two jobs of the workflow (and a person may edit a draft), so they are checked like the bytes.
    if (trimNotes(release.body) !== trimNotes(input.notes)) {
        throw new StepFailure(
            `the notes of the release ${facts.version} do not match the CHANGELOG at the tag: ${release.url}`,
            FIX(facts.version, release),
            [`the draft's notes: ${JSON.stringify(shortNotes(release.body))}`, `the CHANGELOG at ${facts.version}: ${JSON.stringify(shortNotes(input.notes))}`],
            false,
        );
    }
    reporter.success("verify", `release notes equal the CHANGELOG section of ${facts.version}`);

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
            `${FIX(facts.version, release)} A different Node or dependency version in CI, or a build that is not reproducible, are the usual causes (\`opdk release check\` builds the committed tree twice).`,
            differences,
            false,
        );
    }
    reporter.success("verify", `${expected.attested.join(", ")} equal a local build of ${facts.version} (${local.commit}) byte for byte`);

    for (const name of expected.attested) {
        try {
            await gh.text(["attestation", "verify", path.join(input.dir, name), "--repo", repo, "--cert-identity-regex", KIT_SIGNER_REGEX, "--source-ref", `refs/tags/${facts.version}`, "--source-digest", facts.commit]);
        } catch (error) {
            throw new StepFailure(`the attestation of ${name} does not verify: ${error instanceof Error ? error.message : String(error)}`, `${FIX(facts.version, release)} The assets must be attested by ${KIT_WORKFLOW_PATH} for ${repo} at the tag ${facts.version}: the plugin's workflow must call it (a copy of it does not count), and an old gh may not verify new attestations (update it).`, [], false);
        }
    }
    reporter.success("verify", `attestations: ${expected.attested.join(", ")} verified for ${repo} at ${facts.version}`);
}
