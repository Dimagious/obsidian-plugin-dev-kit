import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAC_APP_ASAR, findObsidianAsar } from "./obsidian-path.js";

const present = (...files: string[]) => (file: string) => files.includes(file);

describe("findObsidianAsar", () => {
    it("uses the macOS install by default", () => {
        const found = findObsidianAsar({
            env: {},
            platform: "darwin",
            exists: present(DEFAULT_MAC_APP_ASAR),
            cwd: "/plugin",
        });
        expect(found).toBe(DEFAULT_MAC_APP_ASAR);
    });

    it("prefers OBSIDIAN_PATH over the option and the default", () => {
        const found = findObsidianAsar({
            option: "/opt/option.asar",
            env: { OBSIDIAN_PATH: "/opt/env.asar" },
            platform: "darwin",
            exists: present("/opt/env.asar", "/opt/option.asar", DEFAULT_MAC_APP_ASAR),
            cwd: "/plugin",
        });
        expect(found).toBe("/opt/env.asar");
    });

    it("uses the option when the env var is unset or empty, resolved against cwd", () => {
        const expected = path.resolve("/plugin", "tools/app.asar");
        const found = findObsidianAsar({
            option: "tools/app.asar",
            env: { OBSIDIAN_PATH: "" },
            platform: "linux",
            exists: present(expected),
            cwd: "/plugin",
        });
        expect(found).toBe(expected);
    });

    it("does not fall through to the default when an explicit path is missing", () => {
        expect(() =>
            findObsidianAsar({
                env: { OBSIDIAN_PATH: "/typo/app.asar" },
                platform: "darwin",
                exists: present(DEFAULT_MAC_APP_ASAR),
                cwd: "/plugin",
            }),
        ).toThrow(/OBSIDIAN_PATH points to \/typo\/app\.asar, which does not exist/);
    });

    it("names the option when the option path is missing", () => {
        expect(() =>
            findObsidianAsar({ option: "/nope.asar", env: {}, platform: "darwin", exists: present(), cwd: "/plugin" }),
        ).toThrow(/obsidianPath points to \/nope\.asar/);
    });

    it("says where it looked when Obsidian is not installed", () => {
        expect(() => findObsidianAsar({ env: {}, platform: "darwin", exists: present(), cwd: "/plugin" })).toThrow(
            `Obsidian is not installed at ${DEFAULT_MAC_APP_ASAR}`,
        );
    });

    it("asks for an explicit path on platforms without a default", () => {
        expect(() => findObsidianAsar({ env: {}, platform: "linux", exists: present(), cwd: "/plugin" })).toThrow(
            /No default Obsidian location for platform "linux".*OBSIDIAN_PATH/,
        );
    });
});
