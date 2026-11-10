import { parseArgv } from "./argv.js";
import type { CommandRegistry } from "./registry.js";
import type { Command, CommandContext } from "./types.js";

const ROADMAP_URL = "https://github.com/Dimagious/obsidian-plugin-dev-kit#roadmap";

export interface CliOptions {
    readonly registry: CommandRegistry;
    readonly version: string;
    readonly ctx: CommandContext;
}

/** Runs one CLI invocation and returns the exit code. */
export async function runCli(argv: readonly string[], options: CliOptions): Promise<number> {
    const { registry, version, ctx } = options;
    const parsed = parseArgv(argv);

    switch (parsed.kind) {
        case "help":
            ctx.stdout(renderHelp(registry, version));
            return 0;
        case "version":
            ctx.stdout(`${version}\n`);
            return 0;
        case "command-help": {
            const command = registry.get(parsed.name);
            if (command === undefined) {
                return unknownCommand(parsed.name, ctx);
            }
            ctx.stdout(`${command.usage.trimEnd()}\n`);
            return 0;
        }
        case "run": {
            const command = registry.get(parsed.name);
            if (command === undefined) {
                return unknownCommand(parsed.name, ctx);
            }
            return runCommand(command, parsed.args, ctx);
        }
    }
}

function unknownCommand(name: string, ctx: CommandContext): number {
    ctx.reporter.error(`opdk: unknown command "${name}". Run "opdk --help" to list the available commands.`);
    return 1;
}

async function runCommand(command: Command, args: readonly string[], ctx: CommandContext): Promise<number> {
    try {
        return await command.run(args, ctx);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const debug = ctx.env.OPDK_DEBUG === "1" && error instanceof Error ? error.stack : undefined;
        ctx.reporter.error(`opdk: command "${command.name}" failed: ${message}`, debug?.split("\n"));
        return 1;
    }
}

function renderHelp(registry: CommandRegistry, version: string): string {
    const lines = [`opdk ${version}`, "", "Usage: opdk <command> [options]", ""];
    if (registry.size === 0) {
        lines.push(`No commands are registered yet. See the roadmap: ${ROADMAP_URL}`);
    } else {
        lines.push("Commands:");
        const width = Math.max(...Array.from(registry.keys(), (name) => name.length));
        for (const command of registry.values()) {
            lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`);
        }
        lines.push("", 'Run "opdk <command> --help" for details.');
    }
    lines.push("", "Options:", "  -h, --help     Show this help", "  --version      Show the kit version");
    return `${lines.join("\n")}\n`;
}
