import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReporter } from "../cli/reporter.js";
import type { CommandContext } from "../cli/types.js";
import { registerTempDir } from "./temp-registry.js";

/**
 * A throwaway plugin directory for tests that touch the file system. Remove it with `cleanup()`; one the test forgets
 * is removed after the test by the registry (`temp-registry.ts`).
 */
export interface PluginFixture {
    readonly dir: string;
    /** Writes a file (creating folders) relative to the plugin root. */
    write(relativePath: string, content: string | Uint8Array): void;
    cleanup(): void;
}

export function createPluginFixture(manifest: Record<string, unknown> = {}): PluginFixture {
    const dir = mkdtempSync(path.join(tmpdir(), "opdk-plugin-"));
    const remove = registerTempDir(dir);
    const write = (relativePath: string, content: string | Uint8Array): void => {
        const file = path.join(dir, relativePath);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
    };
    write(
        "manifest.json",
        JSON.stringify({ id: "fixture-plugin", name: "Fixture", version: "1.0.0", isDesktopOnly: false, ...manifest }),
    );
    return {
        dir,
        write,
        cleanup: remove,
    };
}

export interface CapturedContext extends CommandContext {
    readonly out: string[];
    readonly err: string[];
}

/** A command context that records output instead of printing it. */
export function createContext(
    cwd: string,
    env: Record<string, string> = {},
    onInterrupt?: CommandContext["onInterrupt"],
): CapturedContext {
    const out: string[] = [];
    const err: string[] = [];
    const stdout = (text: string): void => {
        out.push(text);
    };
    const stderr = (text: string): void => {
        err.push(text);
    };
    return {
        cwd,
        env,
        out,
        err,
        stdout,
        stderr,
        // Plain mode: tests assert exact strings without escape codes.
        reporter: createReporter({ stdout, stderr, colorStdout: false, colorStderr: false }),
        ...(onInterrupt !== undefined && { onInterrupt }),
    };
}
