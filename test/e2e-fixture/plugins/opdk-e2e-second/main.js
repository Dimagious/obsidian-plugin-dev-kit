// Prebuilt on purpose (see the other fixture plugin). Registers its command synchronously.
const { Plugin } = require("obsidian");

module.exports = class SecondPlugin extends Plugin {
    onload() {
        this.addCommand({ id: "ping", name: "Ping", callback: () => undefined });
    }
};
