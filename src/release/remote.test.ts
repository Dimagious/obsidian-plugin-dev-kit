import { describe, expect, it } from "vitest";
import { parseRemoteUrl, slugText } from "./remote.js";

describe("parseRemoteUrl", () => {
    it.each([
        ["https://github.com/Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["https://github.com/Dimagious/snipsy", "Dimagious/snipsy"],
        ["https://github.com/Dimagious/snipsy/", "Dimagious/snipsy"],
        ["https://user:token@github.com/Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["git@github.com:Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["git@github-personal:Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["github.com:Dimagious/snipsy", "Dimagious/snipsy"],
        ["ssh://git@github.com/Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["ssh://git@github.com:22/Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["git://github.com/Dimagious/snipsy.git", "Dimagious/snipsy"],
        ["https://github.com/Dimagious/obsidian.plugin-x.git", "Dimagious/obsidian.plugin-x"],
    ])("reads %s", (url, expected) => {
        const slug = parseRemoteUrl(url);
        expect(slug === undefined ? undefined : slugText(slug)).toBe(expected);
    });

    it.each(["", "/some/local/path", "../origin.git", "C:\\repos\\origin.git", "https://github.com/onlyowner", "https://github.com/a/b/c.git", "file:///tmp/origin.git"])("rejects %j", (url) => {
        expect(parseRemoteUrl(url)).toBeUndefined();
    });

    it("trims whitespace", () => {
        expect(parseRemoteUrl("  https://github.com/a/b.git\n")).toEqual({ owner: "a", repo: "b" });
    });
});
