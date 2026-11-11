import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { DemoConfig } from "../config/types.js";
import { budgetVerdict, compareFrames, densityWarnings, describeLoopDifference, findStaleOutputs, formatBytes, shortHoldWarning } from "./checks.js";
import {
    baseFilmName,
    demoFolders,
    DEFAULT_GIF_FPS,
    MAX_AUTO_GIF_WIDTH,
    resolveFilmSettings,
    stillsSettings,
    type FilmSettings,
} from "./config.js";
import { buildConcatList, gifArgs, locateFfmpeg, mp4Args, posterArgs, rawFrameArgs, resolveGifWidth } from "./ffmpeg.js";
import { createFfmpegTool, probeFfmpeg, type FfmpegTool } from "./ffmpeg-run.js";
import { assertFrameFiles, listFilms, moveFile, type FoundFilm } from "./films.js";
import { PAGE_HEIGHT, PAGE_SCALE, PAGE_WIDTH, resolvePhoneLayout } from "./phone-layout.js";
import type { ComposeParams } from "./phone-render.js";
import { PUBLISHED_FILE, readPublished, sameRecord, updatePublished, writePublished, type PublishedRecord } from "./published.js";
import { listStills, publishStill, stillKey } from "./stills.js";

const STEP = "demo";

/** The two things the run does outside this process; tests replace them. */
export interface DemoDeps {
    /** Finds ffmpeg and checks it can do the job; throws with the install hint otherwise. */
    locateFfmpeg(env: Readonly<Record<string, string | undefined>>, needsMp4: boolean): Promise<FfmpegTool>;
    /** Renders the caption page for every frame (needs Electron). */
    compose(params: ComposeParams): Promise<void>;
}

export const defaultDeps: DemoDeps = {
    locateFfmpeg: async (env, needsMp4) => {
        const { command } = await locateFfmpeg(env, probeFfmpeg);
        const tool = createFfmpegTool(command);
        if (needsMp4 && !/\blibx264\b/.test(await tool.encoders())) {
            throw new Error(
                `${command} has no libx264 encoder, which the MP4 needs. Install a full build of ffmpeg (macOS: brew install ffmpeg), ` +
                    `point OPDK_FFMPEG at one, or set "mp4: false" in the demo section of opdk.config.mjs.`,
            );
        }
        return tool;
    },
    compose: async (params) => {
        // Loaded here: Playwright and Electron are optional peers and only the phone layout needs them.
        const { composePhoneFrames } = await import("./phone-render.js");
        await composePhoneFrames(params);
    },
};

export interface DemoRunOptions {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** Film names to encode; empty means every complete film. */
    readonly names: readonly string[];
    readonly config: DemoConfig;
    readonly reporter: Reporter;
    readonly source: string;
    readonly deps?: DemoDeps;
    /** Where the work folders go while a film is encoded; removed afterwards. Default: the OS temp folder. */
    readonly tmpDir?: string;
}

interface FilmOutcome {
    readonly written: string[];
    /** Absolute paths of the files moved into the output folder, for the record of what the kit published. */
    readonly files: string[];
    readonly warnings: string[];
    readonly failures: { message: string; hint?: string }[];
}

/** Encodes the films and returns the exit code: 1 when anything failed, warnings do not count. */
export async function runDemo(options: DemoRunOptions): Promise<number> {
    const { reporter, config } = options;
    const deps = options.deps ?? defaultDeps;
    const folders = demoFolders(config);
    const outDir = path.resolve(options.cwd, folders.outDir);
    const output = path.resolve(options.cwd, folders.output);
    const listing = listFilms(outDir);
    const filmNames = new Set([...listing.complete, ...listing.incomplete, ...listing.broken].map((film) => film.name));
    const stillsConfig = stillsSettings(config);
    const stills = listStills(outDir);
    // A name selects a film, a still, or both. With stills turned off a still's name is not one the command knows.
    const stillNames = stillsConfig === null ? [] : stills;
    const unknownNames = options.names.filter((name) => !filmNames.has(name) && !stillNames.includes(name));
    if (unknownNames.length > 0) {
        const hiddenStills = unknownNames.filter((name) => stills.includes(name));
        reporter.failure(STEP, `no film${stillNames.length > 0 ? " or still" : ""} named ${unknownNames.map((name) => `"${name}"`).join(", ")} in ${outDir}`, {
            details: [
                filmNames.size === 0 ? "There are no films there." : `Films there: ${[...filmNames].join(", ")}`,
                ...(stillNames.length > 0 ? [`Stills there: ${stillNames.join(", ")}`] : []),
                ...(hiddenStills.length > 0 ? ["demo.stills is false, so stills are not selectable."] : []),
            ],
            hint: "Run the demo specs first (npx playwright test), or fix the name.",
        });
        return 1;
    }
    const wanted = (name: string): boolean => options.names.length === 0 || options.names.includes(name);
    const selectedStills = stillNames.filter(wanted);
    let failed = false;
    for (const film of listing.broken.filter((item) => wanted(item.name))) {
        failed = true;
        reporter.failure(STEP, `${film.name}: unusable manifest`, { details: [film.reason], hint: "Record the film again." });
    }
    for (const film of listing.incomplete.filter((item) => wanted(item.name))) {
        // Named on the command line, a film that cannot be encoded is a failure; found by scanning it is a note.
        if (options.names.length > 0) {
            failed = true;
            reporter.failure(STEP, `${film.name}: not encoded`, { details: [film.reason] });
        } else {
            reporter.warn(STEP, `${film.name}: skipped, ${film.reason}`);
        }
    }
    // Stills do not stand in for films: films were recorded and none can be encoded, so the run failed. With names,
    // only what was named counts (an incomplete named film already failed above).
    if (options.names.length === 0 && filmNames.size > 0 && listing.complete.length === 0 && !failed) {
        failed = true;
        reporter.failure(STEP, `no complete film among the ${String(filmNames.size)} recorded in ${path.join(outDir, "films")}`, {
            hint: "Run the demo specs again (npx playwright test) and check that they pass.",
        });
    }
    const films = listing.complete.filter((film) => wanted(film.name));
    if (films.length === 0 && selectedStills.length === 0) {
        if (!failed && filmNames.size === 0) {
            reporter.failure(STEP, `no films in ${path.join(outDir, "films")}`, {
                hint: "Record them with the demo fixture (npx playwright test), or set demo.outDir in opdk.config.mjs to where the specs write.",
            });
        }
        return 1;
    }
    const planned = films.map((film) => ({ film, settings: resolveFilmSettings(config, film.name, film.manifest.theme, options.source) }));
    // Before any work: a missing ffmpeg is the same message for every film. A run of stills only does not need one.
    const ffmpeg = planned.length === 0 ? undefined : await deps.locateFfmpeg(options.env, planned.some((item) => item.settings.mp4));
    if (planned.length > 0) {
        fs.mkdirSync(output, { recursive: true });
    }

    const written: Record<string, string> = {};
    // Films (and stills, by their key) that were written without a failure: only they can say that a recorded file of theirs is no longer produced.
    const encoded = new Set<string>();
    for (const { film, settings } of planned) {
        if (ffmpeg === undefined) {
            break;
        }
        const outcome = await encodeFilm({ film, settings, ffmpeg, deps, options, output });
        for (const file of outcome.files) {
            written[projectPath(options.cwd, file)] = film.name;
        }
        if (outcome.failures.length > 0) {
            failed = true;
            for (const failure of outcome.failures) {
                reporter.failure(STEP, `${film.name}: ${failure.message}`, failure.hint === undefined ? {} : { hint: failure.hint });
            }
        } else {
            encoded.add(film.name);
            reporter.success(STEP, `${film.name}: ${outcome.written.join(", ")}`);
        }
        for (const warning of outcome.warnings) {
            reporter.warn(STEP, `${film.name}: ${warning}`);
        }
    }

    if (stillsConfig !== null && publishStills({ names: selectedStills, outDir, folder: path.resolve(options.cwd, stillsConfig.output), cwd: options.cwd, written, encoded, reporter, filmFiles: filmOwnedFiles(outDir) })) {
        failed = true;
    }

    for (const warning of pairWarnings(listing.complete.map((film) => film.manifest))) {
        reporter.warn(STEP, warning);
    }
    // Stills are known whether or not they are published now: turning `demo.stills` off must not make them look orphaned.
    const known = new Set([...filmNames, ...stills.map(stillKey)]);
    reportStale({ outDir, cwd: options.cwd, written, encoded, known, reporter });
    return failed ? 1 : 0;
}

/** The files the published record gives to films (not stills). An unreadable record gives none; reportStale reports it. */
function filmOwnedFiles(outDir: string): PublishedRecord {
    let record: PublishedRecord;
    try {
        record = readPublished(outDir);
    } catch {
        return {};
    }
    return Object.fromEntries(Object.entries(record).filter(([, owner]) => !owner.startsWith("still:")));
}

/** Copies the selected stills into `folder`, reporting each one that was copied. Returns true when any failed. */
function publishStills(params: {
    names: readonly string[];
    outDir: string;
    folder: string;
    cwd: string;
    written: Record<string, string>;
    encoded: Set<string>;
    reporter: Reporter;
    /** Files an earlier run recorded as a film's, so a still named alone cannot take them either. */
    filmFiles: PublishedRecord;
}): boolean {
    const unchanged: string[] = [];
    let failed = false;
    for (const name of params.names) {
        // A still must not replace a film's file, written in this run or recorded by an earlier one (a still named
        // `<film>-poster` would take the poster).
        const destination = projectPath(params.cwd, path.join(params.folder, `${name}.png`));
        const owner = params.written[destination] ?? params.filmFiles[destination];
        if (owner !== undefined) {
            failed = true;
            const what = destination.endsWith("-poster.png") ? "the poster" : "the file";
            params.reporter.failure(STEP, `still "${name}" would overwrite ${what} of film "${owner}"; rename the still`, {
                hint: `${destination} belongs to film "${owner}". Rename ${path.join(params.outDir, "stills", `${name}.png`)} by changing the name passed to demo.still().`,
            });
            continue;
        }
        try {
            const still = publishStill(params.outDir, name, params.folder);
            params.written[projectPath(params.cwd, still.file)] = stillKey(name);
            params.encoded.add(stillKey(name));
            if (still.copied) {
                params.reporter.success(STEP, `still ${name}: png ${formatBytes(still.bytes)}`);
            } else {
                unchanged.push(name);
            }
        } catch (error) {
            failed = true;
            params.reporter.failure(STEP, `still ${name}: ${error instanceof Error ? error.message : String(error)}`, {
                hint: `Check that ${path.join(params.outDir, "stills", `${name}.png`)} can be read and ${params.folder} can be written, or run the spec again.`,
            });
        }
    }
    if (unchanged.length > 0) {
        params.reporter.info(STEP, `${String(unchanged.length)} ${unchanged.length === 1 ? "still" : "stills"} unchanged: ${unchanged.join(", ")}`);
    }
    return failed;
}

/** The record's key for a file: relative to the project, with `/` on every platform. */
function projectPath(cwd: string, file: string): string {
    return path.relative(cwd, file).split(path.sep).join("/");
}

/**
 * Warns about media the kit itself published on an earlier run that no film produces any more (the film is gone, or
 * it encoded cleanly this run without writing the file), then saves the record with this
 * run's files. Only recorded files are named: a folder like docs/screens holds pictures the kit never wrote. With no
 * record yet nothing is stale. A record that cannot be read is reported and replaced, so one bad file does not hide
 * the stale check for good.
 */
function reportStale(params: {
    outDir: string;
    cwd: string;
    written: PublishedRecord;
    encoded: ReadonlySet<string>;
    known: ReadonlySet<string>;
    reporter: Reporter;
}): void {
    const { outDir, reporter } = params;
    const exists = (file: string): boolean => fs.existsSync(path.resolve(params.cwd, file));
    let previous: PublishedRecord = {};
    let readable = true;
    try {
        previous = readPublished(outDir);
    } catch (error) {
        readable = false;
        reporter.warn(STEP, `${error instanceof Error ? error.message : String(error)}; ignoring it and writing a new one in ${path.join(outDir, PUBLISHED_FILE)}.`);
    }
    const stale = findStaleOutputs(previous, params.known, exists, { encoded: params.encoded, written: params.written });
    if (stale.goneFilms.length > 0) {
        reporter.warn(STEP, `media published by an earlier run of this command belongs to films or stills that no longer exist: ${stale.goneFilms.join(", ")}. Delete them if they are obsolete; the command never removes files.`);
    }
    if (stale.notWritten.length > 0) {
        reporter.warn(STEP, `media published by an earlier run of this command is no longer written by its film or still (an output turned off, or moved): ${stale.notWritten.join(", ")}. Delete them if they are obsolete; the command never removes files.`);
    }
    const next = updatePublished(previous, params.written, exists);
    if (!readable || !sameRecord(previous, next)) {
        writePublished(outDir, next);
    }
}

/** `x-light` without `x-dark` (or the other way round): the pair was meant to be both. */
export function pairWarnings(manifests: readonly { name: string; theme: "light" | "dark" | null }[]): string[] {
    const names = new Set(manifests.map((manifest) => manifest.name));
    const warnings: string[] = [];
    for (const manifest of manifests) {
        if (manifest.theme === null) {
            continue;
        }
        const other = manifest.theme === "light" ? "dark" : "light";
        const partner = `${baseFilmName(manifest.name, manifest.theme)}-${other}`;
        if (!names.has(partner)) {
            warnings.push(`${manifest.name}: the ${other} film "${partner}" is missing, so the pair is incomplete. Record both themes, or encode with the pair's name.`);
        }
    }
    return warnings;
}

interface EncodeParams {
    readonly film: FoundFilm;
    readonly settings: FilmSettings;
    readonly ffmpeg: FfmpegTool;
    readonly deps: DemoDeps;
    readonly options: DemoRunOptions;
    readonly output: string;
}

/** Never throws for a problem with one film: the problem goes into `failures`, so the other films still run. */
async function encodeFilm(params: EncodeParams): Promise<FilmOutcome> {
    const outcome: FilmOutcome = { written: [], files: [], warnings: [], failures: [] };
    const { settings } = params;
    const work = fs.mkdtempSync(path.join(params.options.tmpDir ?? os.tmpdir(), "opdk-demo-"));
    try {
        await encodeInto(params, settings, work, outcome);
    } catch (error) {
        outcome.failures.push({ message: error instanceof Error ? error.message : String(error) });
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
    return outcome;
}

async function encodeInto(params: EncodeParams, settings: FilmSettings, work: string, outcome: FilmOutcome): Promise<void> {
    const { film, ffmpeg, deps, options, output } = params;
    const { manifest } = film;
    assertFrameFiles(film.dir, manifest.frames, manifest);
    outcome.warnings.push(...densityWarnings(manifest));

    // The loop is the film as recorded: a layout puts the same caption list around both ends, so it cannot hide a jump.
    if (settings.loop !== "off" && manifest.frames.length > 1) {
        await checkLoop({ ffmpeg, frameDir: film.dir, film, size: { width: manifest.width ?? 0, height: manifest.height ?? 0 }, mode: settings.loop, outcome });
    }

    let frameDir = film.dir;
    let size = { width: manifest.width ?? 0, height: manifest.height ?? 0 };
    if (settings.layout === "phone-captions") {
        if (manifest.kind !== "phone") {
            throw new Error(`layout "phone-captions" is for phone films, and this is a ${manifest.kind} film. Use layout "plain" for it.`);
        }
        if (manifest.captions.length === 0) {
            throw new Error(`layout "phone-captions" puts the film's captions beside the phone, and this film has none. Pass captions to demo.film(), or use layout "plain".`);
        }
        frameDir = path.join(work, "composed");
        size = { width: PAGE_WIDTH * PAGE_SCALE, height: PAGE_HEIGHT * PAGE_SCALE };
        options.reporter.info(STEP, `${film.name}: composing ${String(manifest.frames.length)} frames beside their captions in Electron`);
        await deps.compose({
            cwd: options.cwd,
            filmDir: film.dir,
            frames: manifest.frames,
            captions: manifest.captions,
            layout: resolvePhoneLayout(settings.phone, manifest.theme),
            outDir: frameDir,
            ...(options.tmpDir !== undefined && { tmpDir: options.tmpDir }),
        });
        assertFrameFiles(frameDir, manifest.frames, size);
    }

    const list = path.join(work, "frames.ffconcat");
    fs.writeFileSync(list, buildConcatList(frameDir, manifest.frames));
    const first = manifest.frames[0];
    if (first === undefined) {
        throw new Error("the film has no frames");
    }
    const { width: gifWidth, clamped } = resolveGifWidth(settings.gif?.width ?? null, size.width, MAX_AUTO_GIF_WIDTH);
    if (clamped) {
        outcome.warnings.push(`gif.width ${String(settings.gif?.width)} is wider than the frames (${String(size.width)} px); using ${String(size.width)}. The GIF is not upscaled.`);
    }
    const gifFps = settings.gif === null ? null : (settings.gif.fps ?? Math.min(manifest.fps, DEFAULT_GIF_FPS));
    if (gifFps !== null) {
        const warning = shortHoldWarning(manifest.frames, gifFps);
        if (warning !== null) {
            outcome.warnings.push(warning);
        }
    }

    const budgetCheck = (label: string, file: string): string => {
        const bytes = fs.statSync(file).size;
        const verdict = budgetVerdict(bytes, settings.budget);
        if (verdict === "fail") {
            outcome.failures.push({
                message: `${label} is ${formatBytes(bytes)}, over the ${formatBytes(settings.budget.failBytes)} limit`,
                hint: `Lower the size (demo.films.${baseFilmName(film.name, manifest.theme)}.gif: width, colors, fps), shorten the film, or raise demo.budget.failBytes. The file stays in ${output} for inspection.`,
            });
        } else if (verdict === "warn") {
            outcome.warnings.push(`${label} is ${formatBytes(bytes)}, over the ${formatBytes(settings.budget.warnBytes)} budget`);
        }
        return `${label} ${formatBytes(bytes)}`;
    };
    /**
     * ffmpeg writes to a temporary name in the work folder and the file is moved into the output folder once it is
     * complete, so a failed encode leaves the previous good file where it was and no half-written one.
     */
    const encode = async (fileName: string, args: (out: string) => string[]): Promise<string> => {
        const staging = path.join(work, "encoded");
        fs.mkdirSync(staging, { recursive: true });
        const temporary = path.join(staging, fileName);
        await ffmpeg.run(args(temporary));
        const finished = path.join(output, fileName);
        moveFile(temporary, finished);
        outcome.files.push(finished);
        return finished;
    };

    if (settings.mp4) {
        const out = await encode(`${film.name}.mp4`, (file) => mp4Args({ list, frames: manifest.frames, fps: manifest.fps, out: file }));
        outcome.written.push(budgetCheck("mp4", out));
    }
    if (settings.gif !== null && gifFps !== null) {
        const colors = settings.gif.colors;
        const out = await encode(`${film.name}.gif`, (file) => gifArgs({ list, frames: manifest.frames, fps: gifFps, width: gifWidth, colors, out: file }));
        outcome.written.push(budgetCheck("gif", out));
    }
    if (settings.poster !== null) {
        const { width: posterWidth, clamped: posterClamped } = resolveGifWidth(settings.poster.width, size.width, size.width);
        if (posterClamped) {
            outcome.warnings.push(`poster.width ${String(settings.poster.width)} is wider than the frames (${String(size.width)} px); using ${String(size.width)}. The poster is not upscaled.`);
        }
        const out = await encode(`${film.name}-poster.png`, (file) => posterArgs({ frame: path.join(frameDir, first.file), width: posterWidth, out: file }));
        budgetCheck("poster", out);
        outcome.written.push("poster");
    }
}

async function checkLoop(params: {
    ffmpeg: FfmpegTool;
    frameDir: string;
    film: FoundFilm;
    size: { width: number; height: number };
    mode: "warn" | "fail";
    outcome: FilmOutcome;
}): Promise<void> {
    const { frames } = params.film.manifest;
    const first = frames[0];
    const last = frames.at(-1);
    if (first === undefined || last === undefined) {
        return;
    }
    const decode = async (file: string): Promise<Buffer> => params.ffmpeg.capture(rawFrameArgs(path.join(params.frameDir, file)));
    const difference = compareFrames(await decode(first.file), await decode(last.file), params.size.width, params.size.height);
    if (difference === null) {
        return;
    }
    const message = describeLoopDifference(difference);
    if (params.mode === "fail") {
        params.outcome.failures.push({ message });
    } else {
        params.outcome.warnings.push(message);
    }
}
