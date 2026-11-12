import fs from "node:fs";
import path from "node:path";

/** Files whose presence marks a workspace root; the same list Vite's `searchForWorkspaceRoot` uses. */
const ROOT_FILES = ["pnpm-workspace.yaml", "lerna.json"];

function isWorkspaceManifest(dir: string): boolean {
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) return false;
    try {
        const manifest: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        return typeof manifest === "object" && manifest !== null && "workspaces" in manifest && Boolean(manifest.workspaces);
    } catch {
        // A broken package.json is not a workspace marker; the plugin's own tooling reports it.
        return false;
    }
}

function nearestPackageRoot(start: string): string | undefined {
    for (let dir = start; ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, "package.json"))) return dir;
        if (path.dirname(dir) === dir) return undefined;
    }
}

/**
 * The folder Vite serves files from by default (`server.fs.allow` unset): the nearest parent of `start` that holds
 * `pnpm-workspace.yaml`, `lerna.json` or a `package.json` with `workspaces`, else the nearest folder with a
 * `package.json`, else `start`. It mirrors Vite's `searchForWorkspaceRoot` (without its Deno rule) instead of importing
 * it: `vite` is only a peer of `vitest`, and the kit declares no dependency on it.
 */
export function findWorkspaceRoot(start: string): string {
    for (let dir = start; ; dir = path.dirname(dir)) {
        if (ROOT_FILES.some((name) => fs.existsSync(path.join(dir, name))) || isWorkspaceManifest(dir)) return dir;
        if (path.dirname(dir) === dir) return nearestPackageRoot(start) ?? start;
    }
}
