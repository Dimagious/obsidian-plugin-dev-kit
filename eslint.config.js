import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
    // .claude/ holds local agent notes and research scripts, never shipped (listed in .git/info/exclude).
    { ignores: ["dist/", "coverage/", ".claude/"] },
    eslint.configs.recommended,
    {
        files: ["**/*.ts"],
        extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/explicit-module-boundary-types": "error",
        },
    },
    {
        // Plain JS (the bin launcher and this file) is linted without type information.
        files: ["**/*.js", "**/*.mjs"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: { console: "readonly", process: "readonly", URL: "readonly" },
        },
    },
    {
        // The kit e2e fixture plugins are committed build output (no build step), plain CommonJS that Obsidian loads.
        files: ["test/e2e-fixture/plugins/**/main.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: { module: "writable", require: "readonly", setTimeout: "readonly", IntersectionObserver: "readonly" },
        },
    },
);
