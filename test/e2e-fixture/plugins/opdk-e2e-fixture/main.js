// Prebuilt on purpose: this file is the build output, committed as is, so the kit's e2e smoke needs no build step.
// Its onload() awaits (loadData, then a short delay) BEFORE it registers the command and the settings tab. Obsidian
// puts the plugin into app.plugins.plugins before onload() finishes, so a readiness check that only looks at that
// map would let a spec run while the command and the tab do not exist yet.
const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const ONLOAD_DELAY_MS = 300;

class FixtureSettingTab extends PluginSettingTab {
    display() {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("OPDK E2E Fixture").setDesc("Settings tab registered after an await in onload().");
    }
}

module.exports = class FixturePlugin extends Plugin {
    async onload() {
        this.settings = Object.assign({}, await this.loadData());
        await new Promise((resolve) => setTimeout(resolve, ONLOAD_DELAY_MS));
        this.addCommand({
            id: "late-command",
            name: "Late command",
            callback: () => {
                this.ran = true;
            },
        });
        this.addSettingTab(new FixtureSettingTab(this.app, this));
    }
};
