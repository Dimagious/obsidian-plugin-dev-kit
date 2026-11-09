#!/usr/bin/env node
// Entry point for the `opdk` command. Subcommands land module by module
// (see the README roadmap); until then it only reports what exists.
const [command] = process.argv.slice(2);
if (!command || command === "--help" || command === "-h") {
    console.log("opdk: no commands yet. See https://github.com/Dimagious/obsidian-plugin-dev-kit#roadmap");
    process.exit(0);
}
console.error(`opdk: unknown command "${command}". No commands are implemented yet.`);
process.exit(1);
