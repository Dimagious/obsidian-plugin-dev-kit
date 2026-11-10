import type { Command } from "./types.js";

export type CommandRegistry = ReadonlyMap<string, Command>;

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Builds the lookup table. A Map, so names like "constructor" never hit Object.prototype. */
export function createRegistry(commands: readonly Command[]): CommandRegistry {
    const registry = new Map<string, Command>();
    for (const command of commands) {
        if (!NAME_PATTERN.test(command.name)) {
            throw new Error(
                `Invalid command name "${command.name}": use lowercase letters, digits and dashes, starting with a letter.`,
            );
        }
        if (registry.has(command.name)) {
            throw new Error(`Command "${command.name}" is registered twice.`);
        }
        registry.set(command.name, command);
    }
    return registry;
}
