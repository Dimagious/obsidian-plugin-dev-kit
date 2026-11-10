/** True when `env[name]` is exactly "1": the on switch for specs that only run on request (a capture run, record mode). */
export function isGateOpen(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
    return env[name] === "1";
}

/** The skip reason a closed gate shows in the report. */
export function gateSkipReason(name: string): string {
    return `set ${name}=1 to run this spec`;
}
