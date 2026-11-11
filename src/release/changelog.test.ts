import { describe, expect, it } from "vitest";
import { CHANGELOG } from "../test-support/release-fixture.js";
import { checkChangelog, promoteUnreleased, releaseNotes, unreleasedProblem } from "./changelog.js";

describe("checkChangelog", () => {
    it("passes when the version has a section with an entry", () => {
        expect(checkChangelog(CHANGELOG, "1.0.0", "CHANGELOG.md")).toEqual([]);
    });

    it("fails when the file is missing", () => {
        const [problem] = checkChangelog(undefined, "1.0.0", "CHANGELOG.md");
        expect(problem?.message).toBe("CHANGELOG.md is missing.");
    });

    it("fails when the version has no section, and the hint names the fix", () => {
        const [problem] = checkChangelog(CHANGELOG, "1.1.0", "CHANGELOG.md");
        expect(problem?.message).toBe('CHANGELOG.md has no "## [1.1.0]" section.');
        expect(problem?.hint).toContain("## [Unreleased]");
    });

    it("fails when the section has only headings and blank lines", () => {
        const text = "# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-02-01\n\n### Added\n\n### Fixed\n\n## [1.0.0] - 2026-01-01\n\n- First.\n";
        expect(checkChangelog(text, "1.1.0", "CHANGELOG.md")[0]?.message).toBe('the "## [1.1.0]" section of CHANGELOG.md has no entries.');
    });

    it("does not count the link footer as entries of the last section", () => {
        const text = "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n[1.0.0]: https://example.com/releases/tag/1.0.0\n";
        expect(checkChangelog(text, "1.0.0", "CHANGELOG.md")).toHaveLength(1);
    });

    it("reads a heading without a date and plain text as an entry", () => {
        expect(checkChangelog("## [1.0.0]\n\nInitial version.\n", "1.0.0", "CHANGELOG.md")).toEqual([]);
    });
});

describe("unreleasedProblem", () => {
    it("is undefined when [Unreleased] has entries, whatever its case", () => {
        expect(unreleasedProblem(CHANGELOG, "CHANGELOG.md")).toBeUndefined();
        expect(unreleasedProblem("## [unreleased]\n\n- Something.\n", "CHANGELOG.md")).toBeUndefined();
    });

    it("says what is missing", () => {
        expect(unreleasedProblem(undefined, "CHANGELOG.md")).toContain("CHANGELOG.md is missing");
        expect(unreleasedProblem("## [1.0.0]\n\n- x\n", "CHANGELOG.md")).toContain('no "## [Unreleased]" section');
        expect(unreleasedProblem("## [Unreleased]\n\n### Added\n\n## [1.0.0]\n\n- x\n", "CHANGELOG.md")).toContain("has no entries");
    });
});

describe("promoteUnreleased", () => {
    it("moves the entries under the new heading and leaves an empty [Unreleased]", () => {
        const result = promoteUnreleased(CHANGELOG, "1.1.0", "2026-11-11");
        expect(result).toContain("## [Unreleased]\n\n## [1.1.0] - 2026-11-11\n\n### Added\n\n- Word count in the status bar.\n\n## [1.0.0] - 2026-01-01");
        expect(result.indexOf("## [Unreleased]")).toBeLessThan(result.indexOf("## [1.1.0]"));
        expect(checkChangelog(result, "1.1.0", "CHANGELOG.md")).toEqual([]);
        expect(unreleasedProblem(result, "CHANGELOG.md")).toContain("has no entries");
    });

    it("updates the compare links in the footer", () => {
        const result = promoteUnreleased(CHANGELOG, "1.1.0", "2026-11-11");
        expect(result).toContain(
            [
                "[Unreleased]: https://github.com/example/fixture/compare/1.1.0...HEAD",
                "[1.1.0]: https://github.com/example/fixture/compare/1.0.0...1.1.0",
                "[1.0.0]: https://github.com/example/fixture/releases/tag/1.0.0",
            ].join("\n"),
        );
    });

    it("links the release page when there is no earlier version", () => {
        const text = "## [Unreleased]\n\n- First.\n\n[Unreleased]: https://github.com/example/x/compare/HEAD...HEAD\n";
        expect(promoteUnreleased(text, "0.1.0", "2026-11-11")).toContain("[0.1.0]: https://github.com/example/x/releases/tag/0.1.0");
    });

    it("leaves a footer without an [Unreleased] compare link, and an existing link for the version, alone", () => {
        const noLink = "## [Unreleased]\n\n- A.\n\n## [1.0.0]\n\n- B.\n\n[1.0.0]: https://example.com/1.0.0\n";
        expect(promoteUnreleased(noLink, "1.1.0", "2026-11-11")).not.toContain("[1.1.0]:");
        const existing = `${CHANGELOG}[1.1.0]: https://example.com/already\n`;
        expect(promoteUnreleased(existing, "1.1.0", "2026-11-11").match(/\[1\.1\.0\]:/g)).toHaveLength(1);
    });

    it("keeps a changelog without a footer and its final newline", () => {
        const result = promoteUnreleased("# Changelog\n\n## [Unreleased]\n\n- A.\n", "1.0.0", "2026-11-11");
        expect(result).toBe("# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-11-11\n\n- A.\n");
    });

    it("keeps CRLF line endings", () => {
        const result = promoteUnreleased("## [Unreleased]\r\n\r\n- A.\r\n\r\n## [1.0.0]\r\n\r\n- B.\r\n", "1.1.0", "2026-11-11");
        expect(result).toBe("## [Unreleased]\r\n\r\n## [1.1.0] - 2026-11-11\r\n\r\n- A.\r\n\r\n## [1.0.0]\r\n\r\n- B.\r\n");
    });

    it("throws without an [Unreleased] section", () => {
        expect(() => promoteUnreleased("## [1.0.0]\n\n- A.\n", "1.1.0", "2026-11-11")).toThrow(/no "## \[Unreleased\]"/);
    });
});

describe("releaseNotes", () => {
    const text = "# Changelog\n\n## [Unreleased]\n\n- Next.\n\n## [1.1.0] - 2026-02-01\n\n### Added\n\n- Two.\n- Three.\n\n### Fixed\n\n- Four.\n\n## [1.0.0] - 2026-01-01\n\n- One.\n\n[Unreleased]: https://example.com/compare/1.1.0...HEAD\n[1.0.0]: https://example.com/releases/tag/1.0.0\n";

    it("returns the body between the heading and the next heading, subheadings kept, without the date", () => {
        expect(releaseNotes(text, "1.1.0")).toBe("### Added\n\n- Two.\n- Three.\n\n### Fixed\n\n- Four.");
    });

    it("stops before the link footer in the last section", () => {
        expect(releaseNotes(text, "1.0.0")).toBe("- One.");
    });

    it("reads CRLF files", () => {
        expect(releaseNotes(text.replaceAll("\n", "\r\n"), "1.0.0")).toBe("- One.");
    });

    it("returns undefined for a version without a section, and an empty string for an empty one", () => {
        expect(releaseNotes(text, "2.0.0")).toBeUndefined();
        expect(releaseNotes("## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-12-01\n- x\n", "1.0.0")).toBe("");
    });
});
