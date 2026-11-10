import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { TEMP_PREFIX } from "./cleanup.js";
import {
    APP_JSON_DEFAULTS,
    buildObsidianJson,
    copySeedVault,
    createVaultHandle,
    generateVaultId,
    mergeAppJson,
    readJsonObject,
    trustKey,
    writeAppDefaults,
    writeUserData,
} from "./vault.js";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(testTmpRoot(), `${TEMP_PREFIX}test-`));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("generateVaultId", () => {
    it("is 16 hex digits and differs between calls", () => {
        const a = generateVaultId();
        expect(a).toMatch(/^[0-9a-f]{16}$/);
        expect(generateVaultId()).not.toBe(a);
    });
});

describe("trustKey", () => {
    it("is the key Obsidian reads, built from the vault id", () => {
        expect(trustKey("abc123")).toBe("enable-plugin-abc123");
    });
});

describe("buildObsidianJson", () => {
    it("registers the vault with both auto-open markers and disables updates", () => {
        expect(buildObsidianJson({ vaultId: "v1", vaultPath: "/tmp/vault", now: 1234 })).toEqual({
            updateDisabled: true,
            last_open: "v1",
            vaults: { v1: { path: "/tmp/vault", ts: 1234, open: true } },
        });
    });
});

describe("mergeAppJson", () => {
    it("adds the defaults to an empty file", () => {
        expect(mergeAppJson({})).toEqual(APP_JSON_DEFAULTS);
    });

    it("lets the seed vault's own settings win", () => {
        expect(mergeAppJson({ settingsPopoutWindow: true, promptDelete: false })).toEqual({
            settingsPopoutWindow: true,
            alwaysUpdateLinks: true,
            promptDelete: false,
        });
    });
});

describe("copySeedVault", () => {
    it("copies the tree and resolves symlinks to real files", () => {
        const seed = path.join(root, "seed");
        const outside = path.join(root, "outside.txt");
        fs.mkdirSync(path.join(seed, ".obsidian"), { recursive: true });
        fs.writeFileSync(path.join(seed, "Welcome.md"), "hi");
        fs.writeFileSync(outside, "linked");
        fs.symlinkSync(outside, path.join(seed, "linked.txt"));
        const copy = path.join(root, "copy");

        copySeedVault(seed, copy);

        expect(fs.readFileSync(path.join(copy, "Welcome.md"), "utf8")).toBe("hi");
        expect(fs.lstatSync(path.join(copy, "linked.txt")).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(copy, "linked.txt"), "utf8")).toBe("linked");
        fs.writeFileSync(path.join(copy, "linked.txt"), "changed");
        expect(fs.readFileSync(outside, "utf8")).toBe("linked");
    });

    it("resolves a symlinked folder and fails loudly on a dangling link", () => {
        const seed = path.join(root, "seed");
        const realDir = path.join(root, "real-plugin");
        fs.mkdirSync(seed);
        fs.mkdirSync(realDir);
        fs.writeFileSync(path.join(realDir, "main.js"), "//js");
        fs.symlinkSync(realDir, path.join(seed, "plugin"));
        copySeedVault(seed, path.join(root, "copy"));
        expect(fs.lstatSync(path.join(root, "copy", "plugin")).isDirectory()).toBe(true);
        expect(fs.readFileSync(path.join(root, "copy", "plugin", "main.js"), "utf8")).toBe("//js");

        fs.symlinkSync(path.join(root, "gone"), path.join(seed, "dangling"));
        expect(() => {
            copySeedVault(seed, path.join(root, "copy2"));
        }).toThrow(new RegExp(`${seed}.*symlink that points to nothing.*dangling`));
    });

    it("refuses a symlink that points back to a folder being copied, naming the link", () => {
        const seed = path.join(root, "seed");
        fs.mkdirSync(path.join(seed, "notes"), { recursive: true });
        fs.symlinkSync(seed, path.join(seed, "notes", "loop"));
        expect(() => {
            copySeedVault(seed, path.join(root, "copy"));
        }).toThrow(new RegExp(`symlink loop.*${path.join(seed, "notes", "loop")}`));
    });

    it("refuses a loop that goes through a folder outside the seed", () => {
        const seed = path.join(root, "seed");
        const other = path.join(root, "other");
        fs.mkdirSync(seed);
        fs.mkdirSync(other);
        fs.symlinkSync(other, path.join(seed, "a"));
        fs.symlinkSync(seed, path.join(other, "b"));
        expect(() => {
            copySeedVault(seed, path.join(root, "copy"));
        }).toThrow(/symlink loop/);
    });

    it("copies two links to the same folder (not a loop)", () => {
        const seed = path.join(root, "seed");
        const shared = path.join(root, "shared");
        fs.mkdirSync(seed);
        fs.mkdirSync(shared);
        fs.writeFileSync(path.join(shared, "f.md"), "x");
        fs.symlinkSync(shared, path.join(seed, "one"));
        fs.symlinkSync(shared, path.join(seed, "two"));
        copySeedVault(seed, path.join(root, "copy"));
        expect(fs.readFileSync(path.join(root, "copy", "one", "f.md"), "utf8")).toBe("x");
        expect(fs.readFileSync(path.join(root, "copy", "two", "f.md"), "utf8")).toBe("x");
    });

    it("names the folder when the seed vault does not exist", () => {
        const missing = path.join(root, "nope");
        expect(() => {
            copySeedVault(missing, path.join(root, "copy"));
        }).toThrow(`Seed vault ${missing} does not exist`);
    });

    it("rejects a seed that is a file", () => {
        const file = path.join(root, "file");
        fs.writeFileSync(file, "x");
        expect(() => {
            copySeedVault(file, path.join(root, "copy"));
        }).toThrow("is not a folder");
    });
});

describe("readJsonObject", () => {
    it("returns {} for a missing file", () => {
        expect(readJsonObject(path.join(root, "missing.json"))).toEqual({});
    });

    it("reads an object", () => {
        const file = path.join(root, "a.json");
        fs.writeFileSync(file, '{"a":1}');
        expect(readJsonObject(file)).toEqual({ a: 1 });
    });

    it("names the file when it is not JSON or not an object", () => {
        const bad = path.join(root, "bad.json");
        fs.writeFileSync(bad, "{nope");
        expect(() => readJsonObject(bad)).toThrow(`${bad} is not valid JSON`);
        const list = path.join(root, "list.json");
        fs.writeFileSync(list, "[1]");
        expect(() => readJsonObject(list)).toThrow(`${list} must contain a JSON object`);
    });

    it("surfaces read errors other than a missing file", () => {
        expect(() => readJsonObject(root)).toThrow(/EISDIR/);
    });
});

describe("writeUserData and writeAppDefaults", () => {
    it("writes obsidian.json into the user-data folder", () => {
        writeUserData({ userDataDir: root, vaultId: "v1", vaultPath: "/v", now: 5 });
        expect(JSON.parse(fs.readFileSync(path.join(root, "obsidian.json"), "utf8"))).toEqual({
            updateDisabled: true,
            last_open: "v1",
            vaults: { v1: { path: "/v", ts: 5, open: true } },
        });
    });

    it("creates app.json when the seed has none", () => {
        writeAppDefaults(root);
        expect(JSON.parse(fs.readFileSync(path.join(root, ".obsidian", "app.json"), "utf8"))).toEqual(APP_JSON_DEFAULTS);
    });

    it("keeps the seed's settings", () => {
        fs.mkdirSync(path.join(root, ".obsidian"));
        fs.writeFileSync(path.join(root, ".obsidian", "app.json"), '{"promptDelete":false,"alwaysUpdateLinks":false}');
        writeAppDefaults(root);
        expect(JSON.parse(fs.readFileSync(path.join(root, ".obsidian", "app.json"), "utf8"))).toEqual({
            settingsPopoutWindow: false,
            alwaysUpdateLinks: false,
            promptDelete: false,
        });
    });
});

describe("createVaultHandle", () => {
    it("reads, writes (creating folders) and checks files by vault-relative path", () => {
        const vault = createVaultHandle(root);
        expect(vault.path).toBe(root);
        expect(vault.exists("notes/a.md")).toBe(false);
        vault.write("notes/a.md", "hello");
        expect(vault.exists("notes/a.md")).toBe(true);
        expect(vault.read("notes/a.md")).toBe("hello");
        expect(vault.resolve("notes/a.md")).toBe(path.join(root, "notes", "a.md"));
    });

    it("refuses paths that leave the vault", () => {
        const vault = createVaultHandle(path.join(root, "vault"));
        expect(() => vault.read("../outside.txt")).toThrow(/outside the vault/);
        expect(() => {
            vault.write("../../x", "1");
        }).toThrow(/outside the vault/);
        expect(() => vault.exists("/etc/passwd")).toThrow(/outside the vault/);
        expect(() => vault.resolve("a/../../b")).toThrow(/outside the vault/);
    });

    it("does not treat a sibling folder with the same prefix as inside", () => {
        const vault = createVaultHandle(path.join(root, "vault"));
        expect(() => vault.exists("../vault-evil/x")).toThrow(/outside the vault/);
    });

    it("allows the vault root itself", () => {
        expect(createVaultHandle(root).resolve(".")).toBe(root);
    });
});
