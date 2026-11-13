import { asRecord } from "../release/json.js";

/** The kit's own package name: the dependency a plugin declares. */
export const KIT_PACKAGE = "obsidian-plugin-dev-kit";

const FULL_SHA = /^[0-9a-f]{40}$/;

/** A GitHub user or organization name: letters, digits and hyphens, no leading hyphen, 39 characters at most. No dots, so `..` is not an owner. */
const OWNER = "([A-Za-z0-9][A-Za-z0-9-]{0,38})";

/** `github:owner/obsidian-plugin-dev-kit#ref`, and the forms npm writes into a lockfile (`git+ssh://git@github.com/...#sha`). */
const KIT_SPEC = new RegExp(`^(?:github:|(?:git\\+)?(?:ssh://git@|https://)github\\.com/)${OWNER}/obsidian-plugin-dev-kit(?:\\.git)?#(\\S+)$`);

/** `uses: owner/obsidian-plugin-dev-kit/.github/workflows/file.yml@ref # comment`, with an optional list dash. */
const USES_LINE = new RegExp(`^(\\s*(?:-\\s+)?uses:\\s+)${OWNER}/obsidian-plugin-dev-kit/(\\.github/workflows/[^\\s@#]+)@([^\\s#]+)(?:(\\s+#\\s*)(.*?))?\\s*$`);

/** A release tag in a workflow comment: `v0.1.0` or `0.1.0`, followed by nothing or by more text. */
const COMMENT_TAG = /^(v?\d+\.\d+\.\d+)(?![\w.])/;

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export function isFullSha(value: string): boolean {
    return FULL_SHA.test(value);
}

export function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

/** `v0.1.0` and `0.1.0` are one version. */
export function stripV(tag: string): string {
    return tag.replace(/^v/, "");
}

export interface KitSpec {
    readonly owner: string;
    /** Whatever follows `#`: a tag, a branch or a commit. */
    readonly ref: string;
}

/** Undefined when the spec does not point at the kit's repository on GitHub. */
export function parseKitSpec(spec: string): KitSpec | undefined {
    const match = KIT_SPEC.exec(spec);
    const owner = match?.[1];
    const ref = match?.[2];
    return owner === undefined || ref === undefined ? undefined : { owner, ref };
}

/** The kit as package.json declares it. */
export interface PackageJsonPin {
    readonly section: string;
    readonly spec: string;
    readonly parsed: KitSpec;
}

/** The kit as the lockfile resolved it. */
export interface LockPin {
    /** The package version at that commit. */
    readonly version: string | undefined;
    /** Undefined when `resolved` does not name a commit. */
    readonly commit: string | undefined;
}

export interface UsesPin {
    /** Path relative to the plugin root, with forward slashes. */
    readonly file: string;
    /** 1-based. */
    readonly line: number;
    readonly owner: string;
    /** The ref after `@`: a full commit SHA when pinned properly. */
    readonly ref: string;
    /** The tag the trailing comment names, if it starts with one. */
    readonly commentTag: string | undefined;
}

export interface KitPins {
    readonly packageJson: readonly PackageJsonPin[];
    readonly lock: LockPin | undefined;
    readonly uses: readonly UsesPin[];
}

export interface WorkflowFile {
    readonly file: string;
    readonly text: string;
}

export function readPackageJsonPins(packageJson: unknown): PackageJsonPin[] {
    const root = asRecord(packageJson);
    return DEPENDENCY_SECTIONS.flatMap((section) => {
        const spec = asRecord(root?.[section])?.[KIT_PACKAGE];
        const parsed = typeof spec === "string" ? parseKitSpec(spec) : undefined;
        return typeof spec === "string" && parsed !== undefined ? [{ section, spec, parsed }] : [];
    });
}

export function readLockPin(lock: unknown): LockPin | undefined {
    const entry = asRecord(asRecord(asRecord(lock)?.packages)?.[`node_modules/${KIT_PACKAGE}`]);
    if (entry === undefined) {
        return undefined;
    }
    const resolved = typeof entry.resolved === "string" ? parseKitSpec(entry.resolved)?.ref : undefined;
    return { version: typeof entry.version === "string" ? entry.version : undefined, commit: resolved !== undefined && isFullSha(resolved) ? resolved : undefined };
}

export function readUsesPins(workflows: readonly WorkflowFile[]): UsesPin[] {
    return workflows.flatMap(({ file, text }) =>
        text.split("\n").flatMap((raw, index) => {
            const match = USES_LINE.exec(raw.replace(/\r$/, ""));
            const owner = match?.[2];
            const ref = match?.[4];
            if (owner === undefined || ref === undefined) {
                return [];
            }
            return [{ file, line: index + 1, owner, ref, commentTag: COMMENT_TAG.exec(match?.[6] ?? "")?.[1] }];
        }),
    );
}

export function readKitPins(input: { packageJson: unknown; lock: unknown; workflows: readonly WorkflowFile[] }): KitPins {
    return { packageJson: readPackageJsonPins(input.packageJson), lock: readLockPin(input.lock), uses: readUsesPins(input.workflows) };
}

/** What the pins say, and what is wrong with them. */
export interface PinVerdict {
    /** Reasons the pins disagree, one sentence each. Empty when they agree. */
    readonly reasons: readonly string[];
    /** One line per place that names the kit, for the details under the failure. */
    readonly places: readonly string[];
    /** The tag package.json names, if it names one. */
    readonly tag: string | undefined;
    /** The commit all places agree on, if they do and any names one. */
    readonly commit: string | undefined;
    readonly usesCount: number;
}

/**
 * Whether package.json, the lockfile and the workflows name one kit release. No network: the lockfile holds the
 * commit, and its `version` stands for the tag (a kit tag is `v` plus the package version).
 */
export function judgePins(pins: KitPins): PinVerdict {
    const reasons: string[] = [];
    const places: string[] = [];
    const commits = new Set<string>();
    const tags: string[] = [];

    for (const pin of pins.packageJson) {
        const { ref } = pin.parsed;
        if (isFullSha(ref)) {
            commits.add(ref);
            places.push(`package.json (${pin.section}): commit ${shortSha(ref)}`);
        } else {
            tags.push(ref);
            places.push(`package.json (${pin.section}): ${ref}`);
        }
    }
    if (pins.lock !== undefined) {
        if (pins.lock.commit !== undefined) {
            commits.add(pins.lock.commit);
        }
        places.push(`package-lock.json: ${pins.lock.commit === undefined ? "no commit in `resolved`" : `commit ${shortSha(pins.lock.commit)}`}${pins.lock.version === undefined ? "" : `, version ${pins.lock.version}`}`);
    }
    for (const use of pins.uses) {
        const where = `${use.file}:${String(use.line)}`;
        const comment = use.commentTag === undefined ? "" : ` (# ${use.commentTag})`;
        if (isFullSha(use.ref)) {
            commits.add(use.ref);
            places.push(`${where}: commit ${shortSha(use.ref)}${comment}`);
        } else {
            reasons.push(`${where} pins the kit's workflow to "${use.ref}", not to a full commit SHA.`);
            places.push(`${where}: ${use.ref}${comment}`);
        }
    }

    if (commits.size > 1) {
        reasons.push(`the places below name ${String(commits.size)} different commits of the kit.`);
    }
    const tag = tags[0];
    const wanted = tag !== undefined ? stripV(tag) : pins.lock?.version;
    if (tag !== undefined && pins.lock?.version !== undefined && stripV(tag) !== pins.lock.version) {
        reasons.push(`package.json asks for ${tag}, but the lockfile holds kit version ${pins.lock.version}.`);
    }
    if (wanted !== undefined) {
        for (const use of pins.uses) {
            if (use.commentTag !== undefined && stripV(use.commentTag) !== wanted) {
                reasons.push(`${use.file}:${String(use.line)} says # ${use.commentTag}, but the kit is at ${wanted}.`);
            }
        }
    }
    return { reasons, places, tag, commit: commits.size === 1 ? [...commits][0] : undefined, usesCount: pins.uses.length };
}

export interface TextChange {
    readonly line: number;
    readonly before: string;
    readonly after: string;
}

export interface Rewritten {
    readonly text: string;
    readonly changes: readonly TextChange[];
}

/** Points every kit dependency spec in package.json at `tag`, keeping the rest of the text as it is. */
export function rewritePackageJson(text: string, tag: string): Rewritten {
    const changes: TextChange[] = [];
    const lines = text.split("\n").map((raw, index) => {
        const cr = raw.endsWith("\r") ? "\r" : "";
        const line = cr === "" ? raw : raw.slice(0, -1);
        const match = /^(\s*"obsidian-plugin-dev-kit"\s*:\s*")([^"]*)(".*)$/.exec(line);
        const spec = match?.[2];
        if (match?.[1] === undefined || spec === undefined || match[3] === undefined || parseKitSpec(spec) === undefined) {
            return raw;
        }
        const after = `${match[1]}${spec.slice(0, spec.lastIndexOf("#") + 1)}${tag}${match[3]}`;
        if (after !== line) {
            changes.push({ line: index + 1, before: line, after });
        }
        return `${after}${cr}`;
    });
    return { text: lines.join("\n"), changes };
}

/**
 * Points every `uses: <owner>/obsidian-plugin-dev-kit/.github/workflows/<file>@...` line of that owner (the one in
 * package.json; GitHub names are case-insensitive) at `sha`. A comment that
 * starts with a version gets the new tag; no comment gets `# <tag>` (unless the line is at `sha` already); any other
 * comment stays as written.
 */
export function rewriteWorkflow(text: string, sha: string, tag: string, wantedOwner: string): Rewritten {
    const changes: TextChange[] = [];
    const lines = text.split("\n").map((raw, index) => {
        const cr = raw.endsWith("\r") ? "\r" : "";
        const line = cr === "" ? raw : raw.slice(0, -1);
        const match = USES_LINE.exec(line);
        const prefix = match?.[1];
        const owner = match?.[2];
        const workflow = match?.[3];
        if (prefix === undefined || owner === undefined || workflow === undefined || owner.toLowerCase() !== wantedOwner.toLowerCase()) {
            return raw;
        }
        const comment = match?.[6];
        if (match?.[4] === sha && (comment === undefined || comment === "")) {
            // Already at the commit: the comment is optional, so a missing one is not worth a change.
            return raw;
        }
        const commentTag = comment === undefined ? undefined : COMMENT_TAG.exec(comment)?.[1];
        let tail = ` # ${tag}`;
        if (comment !== undefined && comment !== "") {
            tail = commentTag === undefined ? `${match?.[5] ?? " # "}${comment}` : `${match?.[5] ?? " # "}${tag}${comment.slice(commentTag.length)}`;
        }
        const after = `${prefix}${owner}/obsidian-plugin-dev-kit/${workflow}@${sha}${tail}`;
        if (after !== line) {
            changes.push({ line: index + 1, before: line, after });
        }
        return `${after}${cr}`;
    });
    return { text: lines.join("\n"), changes };
}
