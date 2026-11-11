/**
 * The manifest.json rules of the release check.
 *
 * Source: the official GitHub Action obsidianmd/obsidian-workflows (v1.2.3), `src/manifest.ts`
 * (`validatePluginManifest`, `validateDescription`, `validateAuthor`, `validateUrl`), read on 2026-11-11, with the
 * same split between errors and warnings. Where the action is more lenient than the scanner's lint rule
 * `obsidianmd/validate-manifest` (eslint-plugin-obsidianmd 0.5.1), the lint rule wins for the three things the
 * developer docs (docs.obsidian.md/Reference/Manifest) call required: `author`, `minAppVersion` and `isDesktopOnly`
 * are errors here, the action only recommends them. `helpUrl` is a known field because the lint rule accepts it.
 *
 * Deliberate differences from the action:
 * - It skips the "obsidian" / "plugin" word check on the id of a plugin that is already in the directory, because an
 *   id can never change. The kit cannot know that, so an id with such a word is a warning here, and a name with one
 *   is an error as in the action.
 * - `helpUrl` is accepted and its URL is checked like the others.
 * - The action's `author-url-own-repo` check (authorUrl points at the plugin's own repository) needs the repository
 *   URL, which the kit does not read; the general warning "authorUrl links to a repository" covers it.
 * - A URL field with the wrong type (`authorUrl`, `helpUrl` not a string; `fundingUrl` neither a string nor an object
 *   of strings, arrays included) is an error here.
 */
import { errorProblem, warningProblem, type Problem } from "./problems.js";
import { asRecord, type JsonRecord } from "./json.js";
import { isSemver } from "./semver.js";

const GROUP = "manifest";

const KNOWN_FIELDS = new Set([
    "id",
    "name",
    "version",
    "description",
    "minAppVersion",
    "author",
    "authorUrl",
    "fundingUrl",
    "isDesktopOnly",
    "helpUrl",
]);
const REQUIRED_STRINGS = ["id", "name", "version", "description", "minAppVersion", "author"] as const;
const BANNED_WORDS = ["obsidian", "plugin"] as const;
const AUTHOR_PLACEHOLDERS = new Set(["your name", "author", "me", "unknown", "anonymous", "plugin author", "your-name"]);
// The lookbehind pins the local part to a run boundary; without it a long run backtracks quadratically.
const EMAIL = /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const HTTP_URL = /https?:\/\/\S+/i;
const RAW_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const error = (message: string, hint?: string): Problem => errorProblem(GROUP, `manifest.json: ${message}`, hint);
const warning = (message: string, hint?: string): Problem => warningProblem(GROUP, `manifest.json: ${message}`, hint);

/** All findings for the parsed contents of manifest.json. */
export function checkManifestRules(value: unknown): Problem[] {
    const manifest = asRecord(value);
    if (manifest === undefined) {
        return [error("must contain a JSON object.", 'Write an object such as { "id": "my-plugin", "name": "My Plugin", ... }.')];
    }
    return [
        ...checkRequired(manifest),
        ...checkId(manifest),
        ...checkName(manifest),
        ...checkVersion(manifest),
        ...checkDescription(manifest),
        ...checkMinAppVersion(manifest),
        ...checkAuthor(manifest),
        ...checkDesktopOnly(manifest),
        ...checkUrls(manifest),
        ...checkUnknownFields(manifest),
    ];
}

function checkRequired(manifest: JsonRecord): Problem[] {
    const problems: Problem[] = [];
    for (const field of REQUIRED_STRINGS) {
        const present = Object.hasOwn(manifest, field);
        const fieldValue = manifest[field];
        if (!present) {
            problems.push(error(`required field "${field}" is missing.`, `Add "${field}" to manifest.json.`));
        } else if (typeof fieldValue !== "string") {
            problems.push(error(`"${field}" must be a string.`, `Change "${field}" to a string.`));
        } else if (fieldValue.trim() === "") {
            problems.push(error(`"${field}" is empty.`, `Give "${field}" a value.`));
        }
    }
    if (!Object.hasOwn(manifest, "isDesktopOnly")) {
        problems.push(error('required field "isDesktopOnly" is missing.', 'Add "isDesktopOnly": false (or true when the plugin needs Node or Electron).'));
    }
    return problems;
}

function text(manifest: JsonRecord, field: string): string | undefined {
    const fieldValue = manifest[field];
    return typeof fieldValue === "string" && fieldValue.trim() !== "" ? fieldValue : undefined;
}

function bannedWordsIn(value: string): string[] {
    const lower = value.toLowerCase();
    return BANNED_WORDS.filter((word) => lower.includes(word));
}

function checkId(manifest: JsonRecord): Problem[] {
    const id = text(manifest, "id");
    if (id === undefined) {
        return [];
    }
    return bannedWordsIn(id).map((word) =>
        warning(
            `id "${id}" contains "${word}".`,
            "The directory asks new plugins to leave it out. An id never changes after the plugin is published, so only a plugin that is not released yet should rename it.",
        ),
    );
}

function checkName(manifest: JsonRecord): Problem[] {
    const name = text(manifest, "name");
    if (name === undefined) {
        return [];
    }
    const problems = bannedWordsIn(name).map((word) =>
        error(`name "${name}" must not contain "${word}".`, `Rename the plugin in manifest.json ("${word}" is implied by the plugin directory).`),
    );
    if (name.length > 50) {
        problems.push(warning(`name is ${String(name.length)} characters long; the maximum is 50.`, "Shorten the name."));
    }
    const capitals = name.match(/[A-Z]/g)?.length ?? 0;
    if (capitals >= 2 && name === name.toUpperCase()) {
        problems.push(warning(`name "${name}" is all capitals.`, "Write the name in normal case."));
    }
    return problems;
}

function checkVersion(manifest: JsonRecord): Problem[] {
    const version = text(manifest, "version");
    if (version === undefined) {
        return [];
    }
    if (version === "0.0.0") {
        return [error('version is the placeholder "0.0.0".', "Set the real version of the release.")];
    }
    return [];
}

function checkDescription(manifest: JsonRecord): Problem[] {
    const description = text(manifest, "description");
    if (description === undefined) {
        return [];
    }
    const trimmed = description.trim();
    const lower = trimmed.toLowerCase();
    const name = (text(manifest, "name") ?? "").trim().toLowerCase();
    const problems: Problem[] = [];
    if (trimmed.length < 10) {
        problems.push(warning(`description is ${String(trimmed.length)} characters long; say what the plugin does (10 or more).`));
    }
    if (name !== "" && lower === name) {
        problems.push(error("description is the same as the plugin name.", "Describe what the plugin does."));
    } else if (name !== "" && lower.startsWith(name)) {
        problems.push(warning("description starts with the plugin name.", "Start with what the plugin does."));
    }
    if (/\b(?:this plugin|a plugin that|the plugin)\b/i.test(trimmed)) {
        problems.push(warning("description refers to itself as a plugin.", 'Say what it does ("Sync notes to ...") instead of "this plugin ...".'));
    }
    if (trimmed.length > 250) {
        problems.push(error(`description is ${String(trimmed.length)} characters long; the maximum is 250.`, "Shorten it."));
    }
    if (!/[.!?]$/.test(trimmed)) {
        problems.push(warning("description does not end with a period, exclamation mark or question mark.", "End the sentence with punctuation."));
    }
    if (/obsidian/i.test(trimmed)) {
        problems.push(error('description contains the brand name "Obsidian".', "Remove it; the directory already says it is for Obsidian."));
    }
    return problems;
}

function checkMinAppVersion(manifest: JsonRecord): Problem[] {
    const minAppVersion = text(manifest, "minAppVersion");
    if (minAppVersion === undefined || isSemver(minAppVersion)) {
        return [];
    }
    return [error(`minAppVersion "${minAppVersion}" is not a version like 1.5.0.`, "Write three numbers separated by dots.")];
}

function checkAuthor(manifest: JsonRecord): Problem[] {
    const author = text(manifest, "author");
    if (author === undefined) {
        return [];
    }
    const trimmed = author.trim();
    const problems: Problem[] = [];
    if (AUTHOR_PLACEHOLDERS.has(trimmed.toLowerCase())) {
        problems.push(error(`author "${trimmed}" is a placeholder.`, "Put your name in author."));
    }
    if (EMAIL.test(trimmed)) {
        problems.push(error("author contains an email address.", "Keep only a name in author; put links in authorUrl."));
    }
    if (HTTP_URL.test(trimmed)) {
        problems.push(error("author contains a URL.", "Keep only a name in author; put the link in authorUrl."));
    }
    return problems;
}

function checkDesktopOnly(manifest: JsonRecord): Problem[] {
    if (Object.hasOwn(manifest, "isDesktopOnly") && typeof manifest.isDesktopOnly !== "boolean") {
        return [error('"isDesktopOnly" must be true or false.', 'Write it without quotes: "isDesktopOnly": false.')];
    }
    return [];
}

function checkUrls(manifest: JsonRecord): Problem[] {
    return [...checkUrlField(manifest, "authorUrl"), ...checkFunding(manifest), ...checkUrlField(manifest, "helpUrl")];
}

/** A URL field that may be absent but, when present, must be a string holding a valid URL. */
function checkUrlField(manifest: JsonRecord, field: "authorUrl" | "helpUrl"): Problem[] {
    if (!Object.hasOwn(manifest, field)) {
        return [];
    }
    const url = manifest[field];
    if (typeof url !== "string") {
        return [error(`"${field}" must be a string.`, `Write ${field} as a text value such as "https://example.com".`)];
    }
    return checkUrl(url, field);
}

/** `fundingUrl` is one URL or an object of platform names to URLs; an array or anything else is refused. */
function checkFunding(manifest: JsonRecord): Problem[] {
    if (!Object.hasOwn(manifest, "fundingUrl")) {
        return [];
    }
    const funding = manifest.fundingUrl;
    if (typeof funding === "string") {
        return checkUrl(funding, "fundingUrl");
    }
    const labelled = asRecord(funding);
    if (labelled === undefined) {
        return [error('"fundingUrl" must be a string or an object of links.', 'Write "fundingUrl": "https://example.com" or "fundingUrl": { "Coffee": "https://example.com" }.')];
    }
    const problems: Problem[] = [];
    for (const [platform, url] of Object.entries(labelled)) {
        if (typeof url !== "string") {
            problems.push(error(`"fundingUrl.${platform}" must be a string.`, "Give each funding platform a link as text."));
        } else {
            problems.push(...checkUrl(url, `fundingUrl.${platform}`));
        }
    }
    return problems;
}

function checkUrl(url: string, field: string): Problem[] {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return [error(`${field} "${url}" is not a valid URL.`, "Write a full address such as https://example.com.")];
    }
    const problems: Problem[] = [];
    if (parsed.protocol !== "https:") {
        problems.push(error(`${field} "${url}" must use HTTPS.`, "Change the address to start with https://."));
    }
    if (RAW_IPV4.test(parsed.hostname)) {
        problems.push(error(`${field} "${url}" must not use a bare IP address.`, "Use a host name."));
    }
    if (parsed.hostname === "obsidian.md" || parsed.hostname === "www.obsidian.md") {
        problems.push(error(`${field} "${url}" must not point to obsidian.md.`, "Link to your own page."));
    }
    if (field === "authorUrl" && (parsed.hostname === "github.com" || parsed.hostname === "www.github.com")) {
        if (parsed.pathname.split("/").filter(Boolean).length >= 2) {
            problems.push(warning(`authorUrl "${url}" links to a repository.`, "Link to your profile page instead."));
        }
    }
    return problems;
}

function checkUnknownFields(manifest: JsonRecord): Problem[] {
    return Object.keys(manifest)
        .filter((field) => !KNOWN_FIELDS.has(field))
        .map((field) => warning(`unknown field "${field}".`, `Obsidian ignores it and the directory reports it. Known fields: ${[...KNOWN_FIELDS].join(", ")}.`));
}
