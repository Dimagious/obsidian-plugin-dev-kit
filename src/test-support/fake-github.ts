import { existsSync } from "node:fs";
import path from "node:path";
import type { RunGh } from "../release/gh.js";
import type { Clock } from "../release/publish-wait.js";
import { KIT_SIGNER_REGEX } from "../release/publish-verify.js";
import { KIT_WORKFLOW_PATH } from "../release/workflow-run.js";

const reEscape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Virtual time: `sleep` advances `now` and returns at once, so a wait of minutes costs nothing. */
export function fakeClock(): Clock & { elapsed(): number } {
    let time = 1_000_000;
    return {
        now: () => time,
        sleep: (ms) => {
            time += ms;
            return Promise.resolve();
        },
        elapsed: () => time - 1_000_000,
    };
}

/** A workflow run as the REST API returns it. */
export interface FakeRun {
    id: number;
    status: string;
    conclusion: string | null;
    event: string;
    head_sha: string;
    html_url: string;
    name: string;
    created_at: string;
    referenced_workflows: { path: string; sha: string; ref: string }[];
}

/** A run of the kit's release workflow on `commit`, completed with success unless `overrides` say otherwise. */
export function kitRun(slug: string, commit: string, overrides: Partial<FakeRun> = {}): FakeRun {
    const id = overrides.id ?? 42;
    return {
        id,
        status: "completed",
        conclusion: "success",
        event: "push",
        head_sha: commit,
        html_url: `https://github.com/${slug}/actions/runs/${String(id)}`,
        name: "Release",
        created_at: "2026-11-11T10:00:00Z",
        referenced_workflows: [{ path: `${KIT_WORKFLOW_PATH}@${"a".repeat(40)}`, sha: "a".repeat(40), ref: "refs/tags/v1" }],
        ...overrides,
    };
}

export interface FakeRelease {
    draft: boolean;
    assets: { name: string; bytes: Buffer; state?: string }[];
}

/**
 * GitHub as `gh` shows it to the release flow: a repository, workflow runs, one release and its attestations.
 * Tests change the public fields between steps; `calls` records every `gh` invocation as a joined string.
 */
export class FakeGithub implements RunGh {
    readonly calls: string[] = [];
    permission = "ADMIN";
    /** Set to make `gh repo view` fail, as when gh is signed in to another account. */
    repoError: Error | undefined;
    /** The runs of the repository; the API lists them filtered by `head_sha` and `event`, as GitHub does. */
    runs: FakeRun[] = [];
    /** What successive reads of one run by id return as `status/conclusion`; the last one repeats. Unset: the run as it is. */
    runStates: string[] | undefined;
    release: FakeRelease | undefined;
    /** Releases of other tags, listed before this one; `pages` of them fill the first pages of the list. */
    otherReleases = 0;
    /** A second release for the tag, as a re-run of a failed workflow makes. */
    duplicateRelease = false;
    /** The commit the attestations are for; `gh attestation verify --source-digest` must pass it. Unset: not checked. */
    commit: string | undefined;
    /** The tag `releases/latest` reports. */
    latest: string | undefined;
    /** When true, publishing does not make the release the latest one. */
    publishKeepsLatest = false;
    /** Asset names whose attestation does not verify. */
    unattested = new Set<string>();
    /** When true, `gh release edit` succeeds without publishing. */
    editIsIgnored = false;
    private viewCount = 0;

    constructor(
        private readonly slug = "example/fixture",
        private readonly tag = "1.0.1",
    ) {}

    text(args: readonly string[]): Promise<string> {
        this.calls.push(args.join(" "));
        return this.answer(args).then((reply) => (typeof reply === "string" ? reply : reply.toString("utf8")));
    }

    bytes(args: readonly string[]): Promise<Buffer> {
        this.calls.push(args.join(" "));
        return this.answer(args).then((reply) => (typeof reply === "string" ? Buffer.from(reply) : reply));
    }

    private async answer(args: readonly string[]): Promise<string | Buffer> {
        await Promise.resolve();
        const line = args.join(" ");
        const api = `repos/${this.slug}`;
        if (line.startsWith("repo view")) {
            if (this.repoError !== undefined) {
                throw this.repoError;
            }
            return JSON.stringify({ nameWithOwner: this.slug, viewerPermission: this.permission });
        }
        const runs = new RegExp(`^api ${reEscape(api)}/actions/runs\\?(.+)$`).exec(line);
        if (runs?.[1] !== undefined) {
            const query = new URLSearchParams(runs[1]);
            const unknown = [...query.keys()].filter((key) => !["head_sha", "event", "per_page"].includes(key));
            if (unknown.length > 0) {
                throw new Error(`fake gh: unsupported run filters ${unknown.join(", ")}`);
            }
            const sha = query.get("head_sha");
            const event = query.get("event");
            const listed = this.runs.filter((run) => (sha === null || run.head_sha === sha) && (event === null || run.event === event));
            return JSON.stringify({ total_count: listed.length, workflow_runs: listed });
        }
        const one = new RegExp(`^api ${reEscape(api)}/actions/runs/(\\d+)$`).exec(line);
        if (one?.[1] !== undefined) {
            const run = this.runs.find((candidate) => candidate.id === Number(one[1]));
            if (run === undefined) {
                throw new Error(`gh api ${api}/actions/runs/${one[1]} failed: Not Found (HTTP 404)`);
            }
            if (this.runStates === undefined) {
                return JSON.stringify(run);
            }
            const state = this.runStates[Math.min(this.viewCount++, this.runStates.length - 1)] ?? "completed/success";
            const [status = "", conclusion = ""] = state.split("/");
            return JSON.stringify({ ...run, status, conclusion: conclusion === "" ? null : conclusion });
        }
        const page = new RegExp(`^api ${reEscape(api)}/releases\\?per_page=(\\d+)&page=(\\d+)$`).exec(line);
        if (page?.[1] !== undefined && page[2] !== undefined) {
            const perPage = Number(page[1]);
            const all = [...Array.from({ length: this.otherReleases }, (_, index) => this.otherReleaseJson(index)), ...(this.release === undefined ? [] : [this.releaseJson(), ...(this.duplicateRelease ? [{ ...this.releaseJson(), id: 8 }] : [])])];
            return JSON.stringify(all.slice((Number(page[2]) - 1) * perPage, Number(page[2]) * perPage));
        }
        const download = new RegExp(`^api -H Accept: application/octet-stream ${reEscape(api)}/releases/assets/(\\d+)$`).exec(line);
        if (download?.[1] !== undefined) {
            const id = Number(download[1]);
            const asset = this.release?.assets[id - 1];
            if (asset === undefined) {
                throw new Error(`gh api: no asset ${String(id)} (HTTP 404)`);
            }
            return asset.bytes;
        }
        if (line.startsWith("release edit")) {
            if (this.release !== undefined && !this.editIsIgnored) {
                this.release.draft = false;
                if (!this.publishKeepsLatest) {
                    this.latest = this.tag;
                }
            }
            return "";
        }
        if (line === `api ${api}/releases/latest`) {
            if (this.latest === undefined) {
                throw new Error(`gh api ${api}/releases/latest failed: gh: Not Found (HTTP 404)`);
            }
            return JSON.stringify({ tag_name: this.latest });
        }
        if (line.startsWith("attestation verify")) {
            const file = args[2] ?? "";
            if (!existsSync(file)) {
                throw new Error(`gh attestation verify: no such file ${file}`);
            }
            const flags = new Map<string, string>();
            for (let index = 3; index < args.length; index += 2) {
                flags.set(args[index] ?? "", args[index + 1] ?? "");
            }
            const wanted: [string, string | undefined][] = [["--repo", this.slug], ["--cert-identity-regex", KIT_SIGNER_REGEX], ["--source-ref", `refs/tags/${this.tag}`], ["--source-digest", this.commit]];
            for (const [flag, value] of wanted) {
                if (flags.get(flag) === undefined || (value !== undefined && flags.get(flag) !== value)) {
                    throw new Error(`gh attestation verify: ${flag} is ${flags.get(flag) ?? "missing"}, expected ${value ?? "a value"}`);
                }
            }
            if (flags.size !== wanted.length) {
                throw new Error(`gh attestation verify: unexpected flags ${[...flags.keys()].join(" ")}`);
            }
            if (this.unattested.has(path.basename(file))) {
                throw new Error("gh attestation verify failed: no attestations found");
            }
            return "Loaded digest sha256:abc for file\n";
        }
        throw new Error(`unexpected gh call: ${line}`);
    }

    private otherReleaseJson(index: number): Record<string, unknown> {
        return { id: 1000 + index, tag_name: `0.0.${String(index)}`, draft: false, prerelease: false, html_url: `https://github.com/${this.slug}/releases/tag/0.0.${String(index)}`, assets: [] };
    }

    private releaseJson(): Record<string, unknown> {
        const release = this.release;
        return {
            id: 7,
            tag_name: this.tag,
            draft: release?.draft ?? false,
            prerelease: false,
            html_url: `https://github.com/${this.slug}/releases/tag/${this.tag}`,
            assets: (release?.assets ?? []).map((asset, index) => ({ id: index + 1, name: asset.name, size: asset.bytes.length, state: asset.state ?? "uploaded" })),
        };
    }
}
