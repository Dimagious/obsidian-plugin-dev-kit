/** The error for a settings modal that did not appear in the main window. */
export function settingsNotOpenedMessage(params: { popoutConfigured: boolean; windows: number; timeoutMs: number }): string {
    if (params.popoutConfigured || params.windows > 1) {
        return (
            "Settings did not open in the main window: Obsidian opened it in a second window. " +
            "The kit sets settingsPopoutWindow to false in the vault's .obsidian/app.json, but a value in the seed vault's app.json wins. " +
            "Set it to false in the seed's .obsidian/app.json, or remove the key."
        );
    }
    return (
        `The settings modal did not appear in the main window within ${String(params.timeoutMs)} ms. ` +
        "Is a dialog covering the workspace? Raise timeouts.helpers.ui if the window is slow."
    );
}

/** The error for a settings tab id that is not registered, with the ids that are. */
export function settingsTabNotFoundMessage(tab: string, registered: readonly string[], timeoutMs: number): string {
    const listed = registered.length > 0 ? registered.join(", ") : "none";
    return (
        `No settings tab with id "${tab}" appeared within ${String(timeoutMs)} ms. Registered tabs: ${listed}. ` +
        `Use the plugin id (the "id" in manifest.json) for a plugin's tab, or a core tab id such as "editor".`
    );
}
