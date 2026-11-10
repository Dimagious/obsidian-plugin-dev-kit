// Prebuilt on purpose: this file is the build output, committed as is, so the kit's e2e smoke needs no build step.
// Its onload() awaits (loadData, then a short delay) BEFORE it registers the command and the settings tab. Obsidian
// puts the plugin into app.plugins.plugins before onload() finishes, so a readiness check that only looks at that
// map would let a spec run while the command and the tab do not exist yet.
// It also holds what the helper specs need: a field a fake can replace (`transport`), a command that uses it, a
// command that shows a notice, and a code block that draws only when it scrolls into view.
const { Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");

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
        // What a plugin's network client would be: the specs replace it with a fake and read back the calls.
        this.transport = (request) => `real:${request}`;
        this.lastResult = null;
        this.registerMarkdownCodeBlockProcessor("opdk-lazy", (_source, el) => {
            // Draws on the first time the element is visible, like the lazy blocks of Dashy.
            const observer = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    el.createEl("div", { cls: "opdk-lazy-rendered", text: "drawn" });
                }
            });
            observer.observe(el);
        });
        await new Promise((resolve) => setTimeout(resolve, ONLOAD_DELAY_MS));
        this.addCommand({
            id: "late-command",
            name: "Late command",
            callback: () => {
                this.ran = true;
            },
        });
        this.addCommand({
            id: "call-transport",
            name: "Call transport",
            callback: () => {
                this.lastResult = this.transport("from-command");
            },
        });
        this.addCommand({
            id: "show-notice",
            name: "Show notice",
            // Duration 0: the notice stays until something removes it.
            callback: () => new Notice("opdk notice", 0),
        });
        this.addCommand({ id: "never-available", name: "Never available", checkCallback: () => false });
        this.addSettingTab(new FixtureSettingTab(this.app, this));
    }
};
