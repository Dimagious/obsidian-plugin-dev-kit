import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerTempDir, removeRegisteredTempDirs } from "./temp-registry.js";

describe("temp registry", () => {
    it("removes a folder through its own remover and then no longer counts it", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "opdk-registry-"));
        const remove = registerTempDir(dir);
        remove();
        expect(existsSync(dir)).toBe(false);
        expect(removeRegisteredTempDirs()).toBe(0);
    });

    it("removes every folder a test left registered", () => {
        const a = mkdtempSync(path.join(tmpdir(), "opdk-registry-"));
        const b = mkdtempSync(path.join(tmpdir(), "opdk-registry-"));
        registerTempDir(a);
        registerTempDir(b);
        expect(removeRegisteredTempDirs()).toBe(2);
        expect([existsSync(a), existsSync(b)]).toEqual([false, false]);
    });
});
