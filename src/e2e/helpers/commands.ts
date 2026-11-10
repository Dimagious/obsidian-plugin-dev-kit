/** Longest list of close matches the "command not found" message shows. */
const MAX_MATCHES = 5;

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
        }
        previous = row;
    }
    return previous[b.length] ?? 0;
}

/**
 * The registered command ids that look like the one asked for: ids that contain it or are contained in it, or that
 * are within a third of its length in edit distance (a typo). Closest first, at most five.
 */
export function closeCommandIds(wanted: string, registered: readonly string[]): string[] {
    const needle = wanted.toLowerCase();
    const maxDistance = Math.max(2, Math.ceil(needle.length / 3));
    return registered
        .map((id) => {
            const lower = id.toLowerCase();
            const contains = lower.includes(needle) || (lower.length >= 3 && needle.includes(lower));
            return { id, score: contains ? 0 : editDistance(needle, lower), contains };
        })
        .filter((candidate) => candidate.contains || candidate.score <= maxDistance)
        .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
        .slice(0, MAX_MATCHES)
        .map((candidate) => candidate.id);
}

/** The error for `runCommand` with an id that is not registered. */
export function commandNotFoundMessage(wanted: string, registered: readonly string[]): string {
    const close = closeCommandIds(wanted, registered);
    const hint =
        close.length > 0
            ? `Close matches: ${close.join(", ")}.`
            : `No registered id is similar (${String(registered.length)} commands are registered).`;
    return (
        `Command "${wanted}" does not exist. ${hint} A command id is "<plugin id>:<command id>"; ` +
        `list them with Object.keys(app.commands.commands) in the Obsidian developer console.`
    );
}

/** The error for a command that exists but whose `checkCallback` declined to run it. */
export function commandDeclinedMessage(id: string): string {
    return (
        `Command "${id}" exists but did not run: its checkCallback returned false. ` +
        `The command needs a context that is missing, for example an open note with a focused editor.`
    );
}

/**
 * Obsidian hotkey notation to Playwright: `Mod` is Cmd on macOS and Ctrl elsewhere, which is what Playwright's
 * `ControlOrMeta` means. Only whole `Mod` tokens change, so `Mod+Shift+P` becomes `ControlOrMeta+Shift+P`.
 */
export function toPlaywrightKeys(keys: string): string {
    if (keys.trim() === "") {
        throw new Error('press() needs a key or a combination such as "Mod+P" or "Escape".');
    }
    return keys.replace(/(^|\+)Mod(?=\+|$)/gi, "$1ControlOrMeta");
}
