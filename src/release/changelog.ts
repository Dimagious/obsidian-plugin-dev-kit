import { errorProblem, type Problem } from "./problems.js";

const GROUP = "changelog";

interface Section {
    /** The text between the brackets of `## [x]`. */
    readonly title: string;
    /** Index of the heading line. */
    readonly heading: number;
    /** Index after the last line that belongs to the section. */
    readonly end: number;
}

const HEADING = /^## \[([^\]]+)\]/;
const LINK_DEFINITION = /^\[[^\]]+\]:\s*\S+/;
const UNRELEASED_LINK = /^\[Unreleased\]:\s*(\S+?)\/compare\/(\S+?)\.\.\.(\S+)\s*$/;

function eolOf(text: string): string {
    return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(text: string): string[] {
    return text.split(/\r?\n/);
}

/** Index where the trailing block of link definitions (`[1.0.0]: https://...`) starts, or `lines.length`. */
function footerStart(lines: readonly string[]): number {
    let start = lines.length;
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index] ?? "";
        if (LINK_DEFINITION.test(line)) {
            start = index;
        } else if (line.trim() !== "") {
            break;
        }
    }
    return start;
}

function findSections(lines: readonly string[]): Section[] {
    const footer = footerStart(lines);
    const headings = lines.flatMap((line, index) => {
        const match = HEADING.exec(line);
        return match?.[1] === undefined ? [] : [{ title: match[1], heading: index }];
    });
    return headings.map((entry, position) => ({
        ...entry,
        end: Math.min(headings[position + 1]?.heading ?? lines.length, Math.max(footer, entry.heading + 1)),
    }));
}

/** Lines that say something: not blank, not a `###` heading. */
function entryCount(lines: readonly string[], section: Section): number {
    return lines.slice(section.heading + 1, section.end).filter((line) => line.trim() !== "" && !line.startsWith("#")).length;
}

/**
 * The CHANGELOG rule: a `## [x.y.z]` section for the version with at least one entry. The kit's CHANGELOG is
 * written by hand, and the section is what the release notes are taken from.
 */
export function checkChangelog(text: string | undefined, version: string, file: string): Problem[] {
    if (text === undefined) {
        return [errorProblem(GROUP, `${file} is missing.`, `Create it with a "## [${version}]" section (Keep a Changelog format).`)];
    }
    const lines = splitLines(text);
    const section = findSections(lines).find((candidate) => candidate.title === version);
    if (section === undefined) {
        return [errorProblem(GROUP, `${file} has no "## [${version}]" section.`, `Move the entries from "## [Unreleased]" under "## [${version}] - YYYY-MM-DD", or run \`opdk release <patch|minor|major>\`.`)];
    }
    if (entryCount(lines, section) === 0) {
        return [errorProblem(GROUP, `the "## [${version}]" section of ${file} has no entries.`, "Say what changed in this version.")];
    }
    return [];
}

/**
 * The body of the `## [version]` section: what the release notes show. The heading, the date and the link
 * footer are left out, `###` subheadings stay, and the blank lines around the body are trimmed. Undefined when
 * the section does not exist; an empty string when it has no text.
 */
export function releaseNotes(text: string, version: string): string | undefined {
    const lines = splitLines(text);
    const section = findSections(lines).find((candidate) => candidate.title === version);
    if (section === undefined) {
        return undefined;
    }
    return lines.slice(section.heading + 1, section.end).join("\n").trim();
}

/** Why `[Unreleased]` cannot be released, or undefined when it has entries. */
export function unreleasedProblem(text: string | undefined, file: string): string | undefined {
    if (text === undefined) {
        return `${file} is missing. Create it with a "## [Unreleased]" section that lists the changes.`;
    }
    const lines = splitLines(text);
    const section = findSections(lines).find((candidate) => candidate.title.toLowerCase() === "unreleased");
    if (section === undefined) {
        return `${file} has no "## [Unreleased]" section. Add one and list the changes of the release in it.`;
    }
    if (entryCount(lines, section) === 0) {
        return `the "## [Unreleased]" section of ${file} has no entries. Write down what changed before releasing.`;
    }
    return undefined;
}

/**
 * Moves the entries of `[Unreleased]` under `## [version] - date` and leaves an empty `[Unreleased]` above it. When
 * the footer has an `[Unreleased]: <base>/compare/<tag>...<head>` link, it points at the new version and a link
 * for the new version is added after it (compared with the version of the section below, else the release page).
 */
export function promoteUnreleased(text: string, version: string, date: string): string {
    const eol = eolOf(text);
    const lines = splitLines(text);
    const sections = findSections(lines);
    const index = sections.findIndex((candidate) => candidate.title.toLowerCase() === "unreleased");
    const unreleased = sections[index];
    if (unreleased === undefined) {
        throw new Error('The changelog has no "## [Unreleased]" section.');
    }
    const body = lines.slice(unreleased.heading + 1, unreleased.end);
    while (body[0]?.trim() === "") {
        body.shift();
    }
    while (body.at(-1)?.trim() === "") {
        body.pop();
    }
    const after = lines.slice(unreleased.end);
    const previous = sections[index + 1]?.title;
    const result = [
        ...lines.slice(0, unreleased.heading),
        "## [Unreleased]",
        "",
        `## [${version}] - ${date}`,
        "",
        ...body,
        ...(after.length > 0 && after[0] !== "" ? [""] : []),
        ...after,
    ];
    const promoted = updateFooter(result, version, previous).join(eol);
    return text.endsWith("\n") && !promoted.endsWith("\n") ? `${promoted}${eol}` : promoted;
}

function updateFooter(lines: string[], version: string, previous: string | undefined): string[] {
    const at = lines.findIndex((line) => UNRELEASED_LINK.test(line));
    const match = UNRELEASED_LINK.exec(lines[at] ?? "");
    const base = match?.[1];
    const head = match?.[3];
    if (at < 0 || base === undefined || head === undefined || lines.some((line) => line.startsWith(`[${version}]:`))) {
        return lines;
    }
    const compare = previous !== undefined && /^\d+\.\d+\.\d+/.test(previous) ? `${base}/compare/${previous}...${version}` : `${base}/releases/tag/${version}`;
    return [...lines.slice(0, at), `[Unreleased]: ${base}/compare/${version}...${head}`, `[${version}]: ${compare}`, ...lines.slice(at + 1)];
}
