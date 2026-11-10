import { buildCommands } from "../build/commands.js";
import { scanCommands } from "../scanner/commands.js";
import type { Command } from "./types.js";

/** Commands shipped with the kit. Each module adds its own entry here when it lands. */
export const builtinCommands: readonly Command[] = [...buildCommands, ...scanCommands];
