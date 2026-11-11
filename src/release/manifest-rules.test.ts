import { describe, expect, it } from "vitest";
import { VALID_MANIFEST } from "../test-support/release-fixture.js";
import { checkManifestRules } from "./manifest-rules.js";

const check = (changes: Record<string, unknown>): string[] =>
    checkManifestRules({ ...VALID_MANIFEST, ...changes }).map((problem) => `${problem.severity}: ${problem.message}`);
const errors = (changes: Record<string, unknown>): string[] => check(changes).filter((line) => line.startsWith("error")).map((line) => line.slice(7));
const warnings = (changes: Record<string, unknown>): string[] => check(changes).filter((line) => line.startsWith("warning")).map((line) => line.slice(9));

describe("a valid manifest", () => {
    it("has no findings", () => {
        expect(checkManifestRules(VALID_MANIFEST)).toEqual([]);
    });
});

describe("required fields", () => {
    it.each(["id", "name", "version", "description", "minAppVersion", "author", "isDesktopOnly"])("fails when %s is missing", (field) => {
        const rest: Record<string, unknown> = { ...VALID_MANIFEST };
        Reflect.deleteProperty(rest, field);
        const problems = checkManifestRules(rest);
        expect(problems.some((problem) => problem.severity === "error" && problem.message.includes(`"${field}" is missing`))).toBe(true);
    });

    it("fails on a field of the wrong type or an empty one", () => {
        expect(errors({ name: 5 })).toContain('manifest.json: "name" must be a string.');
        expect(errors({ description: "  " })).toContain('manifest.json: "description" is empty.');
    });

    it("fails when the manifest is not an object", () => {
        expect(checkManifestRules([])[0]?.message).toContain("must contain a JSON object");
        expect(checkManifestRules(undefined)[0]?.severity).toBe("error");
    });
});

describe("id, name, version", () => {
    it("warns about obsidian or plugin in the id: an id cannot change once published", () => {
        expect(warnings({ id: "obsidian-notes" }).join()).toContain('id "obsidian-notes" contains "obsidian"');
        expect(warnings({ id: "notes-plugin" }).join()).toContain('contains "plugin"');
        expect(errors({ id: "obsidian-notes" })).toEqual([]);
    });

    it("fails on obsidian or plugin in the name", () => {
        expect(errors({ name: "Obsidian Notes" }).join()).toContain('name "Obsidian Notes" must not contain "obsidian"');
        expect(errors({ name: "Notes Plugin" }).join()).toContain('must not contain "plugin"');
    });

    it("warns about a name over 50 characters or in capitals", () => {
        expect(warnings({ name: "N".repeat(51).toLowerCase() }).join()).toContain("51 characters");
        expect(warnings({ name: "FIXTURE" }).join()).toContain("all capitals");
        expect(warnings({ name: "F" })).toEqual([]);
    });

    it("fails on the 0.0.0 placeholder", () => {
        expect(errors({ version: "0.0.0" }).join()).toContain("0.0.0");
    });
});

describe("description", () => {
    it("fails when it equals the name, is over 250 characters or names Obsidian", () => {
        expect(errors({ description: "fixture release" }).join()).toContain("same as the plugin name");
        expect(errors({ description: `${"a".repeat(250)}.` }).join()).toContain("251 characters");
        expect(errors({ description: "Counts words in Obsidian notes." }).join()).toContain("brand name");
    });

    it("accepts exactly 250 characters", () => {
        expect(errors({ description: `${"a".repeat(249)}.` })).toEqual([]);
    });

    it("warns about the rest: short, starts with the name, self-reference, missing punctuation", () => {
        expect(warnings({ description: "Short." }).join()).toContain("6 characters");
        expect(warnings({ description: "Fixture Release counts words." }).join()).toContain("starts with the plugin name");
        expect(warnings({ description: "This plugin counts the words of a note." }).join()).toContain("refers to itself");
        expect(warnings({ description: "Counts the words of the note" }).join()).toContain("does not end with");
    });
});

describe("minAppVersion, author, isDesktopOnly", () => {
    it("fails on a minAppVersion that is not a version", () => {
        expect(errors({ minAppVersion: "1.5" }).join()).toContain('minAppVersion "1.5"');
        expect(errors({ minAppVersion: "1.5.0" })).toEqual([]);
    });

    it("fails on a placeholder author, an email or a URL", () => {
        expect(errors({ author: "Your Name" }).join()).toContain("placeholder");
        expect(errors({ author: "Jane <jane@example.com>" }).join()).toContain("email");
        expect(errors({ author: "Jane https://example.com" }).join()).toContain("author contains a URL");
    });

    it("fails when isDesktopOnly is not a boolean", () => {
        expect(errors({ isDesktopOnly: "false" })).toContain('manifest.json: "isDesktopOnly" must be true or false.');
    });
});

describe("URLs", () => {
    it("fails on a URL that is invalid, not HTTPS, a raw IP or points to obsidian.md", () => {
        expect(errors({ authorUrl: "not a url" }).join()).toContain("not a valid URL");
        expect(errors({ authorUrl: "http://example.com" }).join()).toContain("must use HTTPS");
        expect(errors({ authorUrl: "https://10.0.0.1/me" }).join()).toContain("bare IP address");
        expect(errors({ authorUrl: "https://obsidian.md/me" }).join()).toContain("obsidian.md");
    });

    it("checks fundingUrl as a string and as an object of links", () => {
        expect(errors({ fundingUrl: "http://example.com" }).join()).toContain("fundingUrl");
        expect(errors({ fundingUrl: { Coffee: "http://coffee.example", Other: "https://ok.example" } }).join()).toContain("fundingUrl.Coffee");
        expect(errors({ fundingUrl: { Other: "https://ok.example" } })).toEqual([]);
    });

    it("fails when authorUrl or helpUrl is present but not a string", () => {
        for (const field of ["authorUrl", "helpUrl"]) {
            for (const value of [5, null, ["https://example.com"], { url: "https://example.com" }, true]) {
                expect(errors({ [field]: value }), `${field}: ${JSON.stringify(value)}`).toContain(`manifest.json: "${field}" must be a string.`);
            }
        }
        expect(errors({ helpUrl: "http://example.com/help" }).join()).toContain("helpUrl");
    });

    it("fails when fundingUrl is neither a string nor an object of strings", () => {
        const message = 'manifest.json: "fundingUrl" must be a string or an object of links.';
        for (const value of [5, null, true, ["https://example.com"], [{ Coffee: "https://example.com" }]]) {
            expect(errors({ fundingUrl: value }), JSON.stringify(value)).toContain(message);
        }
        expect(errors({ fundingUrl: { Coffee: 5, Other: "https://ok.example" } })).toEqual(['manifest.json: "fundingUrl.Coffee" must be a string.']);
        expect(errors({ fundingUrl: {} })).toEqual([]);
    });

    it("warns when authorUrl is a repository, not a profile", () => {
        expect(warnings({ authorUrl: "https://github.com/me/repo" }).join()).toContain("links to a repository");
        expect(warnings({ authorUrl: "https://github.com/me" })).toEqual([]);
    });
});

describe("unknown fields", () => {
    it("warns about a field Obsidian does not know and accepts helpUrl", () => {
        expect(warnings({ homepage: "x" }).join()).toContain('unknown field "homepage"');
        expect(warnings({ helpUrl: "https://example.com/help" })).toEqual([]);
    });
});
