import { createRequire } from "node:module";
import path from "node:path";
import { build as esbuildBuild, formatMessages } from "esbuild";
import { ESLint, type Linter } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import { toEsbuildOptions, type ResolvedBuild } from "../build/options.js";
import { isBuildFailure } from "../build/report.js";
import { isOutsideProject } from "../scanner/outside-project.js";
import { errorProblem, warningProblem, type GroupResult, type Problem } from "./problems.js";

const RULE = "obsidianmd/no-unsupported-api";

export interface ApiCheckInput {
    readonly cwd: string;
    readonly minAppVersion: string | undefined;
    /** The build section; its entry decides which files are checked. */
    readonly build: ResolvedBuild;
}

/**
 * The ESLint configuration of the check: only `obsidianmd/no-unsupported-api`, type-aware, with the manifest's
 * `minAppVersion` passed as the rule's own option so it does not depend on which manifest.json the process can see.
 * `opdk scan` is a mirror of the directory's configuration and is not touched; this rule runs here, at release time.
 */
export function createApiConfig(cwd: string, minAppVersion: string): Linter.Config[] {
    return [
        {
            files: ["**/*.{ts,tsx,mts,cts}"],
            languageOptions: {
                parser: tseslint.parser,
                parserOptions: { projectService: true, tsconfigRootDir: cwd },
            },
            plugins: { obsidianmd },
            // Only one rule runs here, so a plugin's disable comments for other rules would all read as unused.
            linterOptions: { reportUnusedDisableDirectives: "off", reportUnusedInlineConfigs: "off" },
            rules: { [RULE]: ["error", { minAppVersion }] },
        },
    ];
}

/** True when `obsidian` (the package that carries the `@since` tags the rule reads) can be resolved from the plugin. */
function obsidianTypesInstalled(cwd: string): boolean {
    try {
        createRequire(path.join(cwd, "package.json")).resolve("obsidian/package.json");
        return true;
    } catch {
        return false;
    }
}

type Inputs = { readonly ok: true; readonly files: readonly string[] } | { readonly ok: false; readonly problem: Problem };

/**
 * The TypeScript files that end up in `main.js`, from esbuild's metafile of the production build (nothing is
 * written), minus `node_modules`. Paths are relative to the plugin folder; a file above it keeps its `..`.
 */
async function bundledSources(cwd: string, build: ResolvedBuild): Promise<Inputs> {
    try {
        const result = await esbuildBuild({ ...toEsbuildOptions(build, cwd, { kind: "release" }), write: false, metafile: true });
        const files = Object.keys(result.metafile.inputs)
            .map((input) => input.split("\\").join("/"))
            .filter((input) => !input.split("/").includes("node_modules") && /\.[cm]?tsx?$/.test(input));
        return { ok: true, files };
    } catch (error) {
        if (!isBuildFailure(error)) {
            throw error;
        }
        const details = (await formatMessages(error.errors, { kind: "error", color: false, terminalWidth: 100 })).flatMap((text) => text.trimEnd().split("\n"));
        return { ok: false, problem: errorProblem("api", "the bundle could not be analysed because the production build fails, so the files it ships are unknown.", "Fix the build errors (see the build group), or skip this check with --no-api.", details) };
    }
}

/**
 * `minAppVersion` against the API the plugin calls: runs `obsidianmd/no-unsupported-api` over the files the bundle
 * is made of (esbuild's metafile, not a guess from `src/**`), so a tracked file that is not shipped is not judged
 * and a shipped one is not missed. Needs the plugin's dependencies installed, because the rule reads `@since` tags
 * from `obsidian.d.ts`.
 *
 * Blind spot: the rule reads those tags through the TypeScript program. When the program does not contain the real
 * `obsidian.d.ts` (for example a tsconfig `paths` entry that points `obsidian` at a stub), the rule has nothing to
 * read and reports nothing, and this check cannot tell. A shipped file that no tsconfig covers is an error, because
 * it would not be checked at all.
 */
export async function checkApiUsage({ cwd, minAppVersion, build }: ApiCheckInput): Promise<GroupResult> {
    if (minAppVersion === undefined) {
        return { group: "api", passed: "", problems: [errorProblem("api", "manifest.json has no minAppVersion, so the API calls cannot be checked against it.", 'Add "minAppVersion" to manifest.json.')] };
    }
    if (!obsidianTypesInstalled(cwd)) {
        return {
            group: "api",
            passed: "",
            problems: [
                errorProblem("api", 'the "obsidian" package is not installed, so no API version can be checked.', "Run `npm ci` in the plugin folder, or skip this check with --no-api."),
            ],
        };
    }
    const inputs = await bundledSources(cwd, build);
    if (!inputs.ok) {
        return { group: "api", passed: "", problems: [inputs.problem] };
    }
    if (inputs.files.length === 0) {
        return { group: "api", passed: "", problems: [warningProblem("api", `the bundle of ${build.entry} contains no TypeScript files, so nothing was checked.`, "Nothing to do for a plugin written in JavaScript.")] };
    }
    const inside = inputs.files.filter((file) => !file.startsWith(".."));
    const eslint = new ESLint({ cwd, overrideConfigFile: true, baseConfig: createApiConfig(cwd, minAppVersion), warnIgnored: false, errorOnUnmatchedPattern: false });
    const results = inside.length === 0 ? [] : await eslint.lintFiles(inside);
    const problems: Problem[] = [];
    const covered = new Set<string>();
    for (const result of results) {
        const file = path.relative(cwd, result.filePath).split(path.sep).join("/");
        if (isOutsideProject(result)) {
            continue;
        }
        covered.add(file);
        for (const message of result.messages) {
            const where = `${file}:${String(message.line)}`;
            if (message.ruleId === RULE) {
                problems.push(errorProblem("api", `${where} ${message.message}`, "Raise minAppVersion in manifest.json (and versions.json for a new version), or guard the call with requireApiVersion()."));
            } else {
                problems.push(errorProblem("api", `${where} could not be analysed: ${message.message}`, "Fix the error; a file that does not parse cannot be checked."));
            }
        }
    }
    const unchecked = inputs.files.filter((file) => !covered.has(file));
    if (unchecked.length > 0) {
        problems.push(
            errorProblem(
                "api",
                `${String(unchecked.length)} file(s) in the bundle are not covered by a tsconfig (or lie outside the plugin folder), so their Obsidian API calls were not checked: ${unchecked.join(", ")}.`,
                "Include them in tsconfig.json (include or files): the rule needs type information. Files above the plugin folder cannot be checked.",
            ),
        );
    }
    return { group: "api", passed: `${String(covered.size)} bundled source file(s) use nothing newer than minAppVersion ${minAppVersion}`, problems };
}
