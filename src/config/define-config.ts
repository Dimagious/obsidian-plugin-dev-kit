import type { OpdkConfig } from "./types.js";

/** Identity helper that gives `opdk.config.mjs` type checking and editor completion. */
export function defineConfig(config: OpdkConfig): OpdkConfig {
    return config;
}
