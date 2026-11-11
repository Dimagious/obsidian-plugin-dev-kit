import { execFileSync } from "node:child_process";

/** Whether `<name> -version` (or the given arguments) runs on this machine. */
export function hasTool(name: string, args: readonly string[] = ["-version"]): boolean {
    try {
        execFileSync(name, [...args], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/** CI sets `CI=true`. On CI a missing ffmpeg is a broken workflow, not a reason to skip the encoder tests. */
export function ciRequiresTools(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
    const value = env.CI;
    return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

export interface RealToolsGate {
    /** True only on a machine without the tools and outside CI. */
    readonly skip: boolean;
    /** The test title; it says "skipped" only when the test is skipped. */
    readonly title: string;
}

/**
 * Decides whether the tests that run the real ffmpeg are skipped. Outside CI they are, when a tool is missing (with
 * the reason in the title, which shows in the report). On CI they never are: with the tools missing they run and
 * fail, so a runner image that lost ffmpeg turns the build red instead of green with the encoder untested.
 */
export function realToolsGate(title: string, available: boolean, env: Readonly<Record<string, string | undefined>> = process.env): RealToolsGate {
    const skip = !available && !ciRequiresTools(env);
    return { skip, title: skip ? `${title} (skipped: ffmpeg and ffprobe are not installed on this machine)` : title };
}
