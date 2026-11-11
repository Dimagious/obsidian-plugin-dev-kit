import { existsSync } from "node:fs";
import path from "node:path";
import type { RunGh } from "../release/gh.js";
import type { Clock } from "../release/publish-wait.js";

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
    /** The runs `gh run list` returns, as the JSON objects gh prints. */
    runs: Record<string, unknown>[] = [];
    /** What successive `gh run view` calls return as `status/conclusion`; the last one repeats. */
    runStates: string[] = ["completed/success"];
    release: FakeRelease | undefined;
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
        if (line.startsWith("run list")) {
            return JSON.stringify(this.runs);
        }
        if (line.startsWith("run view")) {
            const state = this.runStates[Math.min(this.viewCount++, this.runStates.length - 1)] ?? "completed/success";
            const [status = "", conclusion = ""] = state.split("/");
            const base = this.runs[0] ?? {};
            return JSON.stringify({ ...base, status, conclusion });
        }
        if (line === `api ${api}/releases?per_page=50`) {
            return JSON.stringify(this.release === undefined ? [] : [this.releaseJson()]);
        }
        if (line.startsWith("api -H Accept: application/octet-stream")) {
            const id = Number(args.at(-1)?.split("/").at(-1));
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
            return JSON.stringify({ tag_name: this.latest });
        }
        if (line.startsWith("attestation verify")) {
            const file = args[2] ?? "";
            if (!existsSync(file)) {
                throw new Error(`gh attestation verify: no such file ${file}`);
            }
            if (this.unattested.has(path.basename(file))) {
                throw new Error("gh attestation verify failed: no attestations found");
            }
            return "Loaded digest sha256:abc for file\n";
        }
        throw new Error(`unexpected gh call: ${line}`);
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
