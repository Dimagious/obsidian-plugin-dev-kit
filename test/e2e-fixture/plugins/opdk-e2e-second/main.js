// Prebuilt on purpose (see the other fixture plugin). Registers its command synchronously, and its settings tab only
// when the "register-tab" command runs, 600 ms later: a tab that appears after the window is up, for openSettings().
const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const TAB_DELAY_MS = 600;

class SecondSettingTab extends PluginSettingTab {
    display() {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("OPDK E2E Second").setDesc("Settings tab registered by a command, after a delay.");
    }
}

module.exports = class SecondPlugin extends Plugin {
    onload() {
        this.addCommand({ id: "ping", name: "Ping", callback: () => undefined });
        this.addCommand({
            id: "register-tab",
            name: "Register tab",
            callback: () => {
                setTimeout(() => {
                    this.addSettingTab(new SecondSettingTab(this.app, this));
                }, TAB_DELAY_MS);
            },
        });
    }
};
