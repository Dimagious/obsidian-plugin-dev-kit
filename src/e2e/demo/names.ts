/** Longest film or still name the kit accepts; the name becomes a folder or file name. */
const MAX_NAME_LENGTH = 100;
/** One path segment: no separators, no leading dot, nothing a shell or a file system treats specially. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The two colour schemes `demo.themes()` runs a scene in. */
export type ThemeMode = "light" | "dark";

/** A file-name-safe version of free text (a test title): lower case, runs of other characters become one dash. */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_NAME_LENGTH)
        .replace(/-+$/g, "");
}

/** Checks a name given by the spec: it ends up in a path under the output folder, so it must be one safe segment. */
export function assertName(name: string, what: string): string {
    if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
        throw new Error(
            `${what} name ${JSON.stringify(name)} is not usable as a file name. ` +
                `Use letters, digits, dots, dashes and underscores (at most ${String(MAX_NAME_LENGTH)} characters), starting with a letter or digit.`,
        );
    }
    return name;
}

/**
 * The text a film's default name is made of: the describe blocks and the title of the test, and the project when the
 * config has more than one (the same test runs once per project and each run needs its own folder). `titlePath` is
 * Playwright's `testInfo.titlePath`: the test file first, then the describe titles, then the test title.
 */
export function defaultNameText(params: { titlePath: readonly string[]; project: string; projectCount: number }): string {
    const parts = params.titlePath.slice(1);
    return (params.projectCount > 1 ? [...parts, params.project] : parts).join(" ");
}

/** The name a film or still gets: the given one, or the default made of the test's title path; inside `demo.themes()` with the theme appended. */
export function resolveName(given: string | undefined, testTitle: string, theme: ThemeMode | null, what: string): string {
    let base: string;
    if (given === undefined) {
        base = slugify(testTitle);
        if (base === "") {
            throw new Error(`The test title ${JSON.stringify(testTitle)} gives no usable ${what} name. Pass a name.`);
        }
    } else {
        base = assertName(given, what);
    }
    return theme === null ? base : `${base}-${theme}`;
}
