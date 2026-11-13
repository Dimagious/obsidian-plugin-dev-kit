import type { Command } from "../cli/types.js";
import { CONFIG_FILE_NAME, loadConfig } from "../config/load-config.js";
import { parseDemoArgs } from "./args.js";

const demoUsage = `Usage: opdk demo [names...]

Turns the films the demo fixture recorded into finished media, in the output folder
(default docs/screens): <name>.mp4, <name>.gif and <name>-poster.png for each film.

  frames    <demo.outDir>/films/<name>/ (default .opdk/demo), from manifest.json; only
            films whose recording finished are encoded, the others are listed with why
  mp4       x264, yuv420p, crf 20, preset slow, faststart, at the film's fps
  gif       its own palette, 128 colours, 10 fps (the film's fps when lower), as wide as
            the frames up to 1000 px
  poster    the first frame, as wide as the MP4 (demo.poster: { width } or false)
  stills    <demo.outDir>/stills/<name>.png is copied to the output folder as <name>.png, only
            when its bytes changed (demo.stills: false turns it off, { output } picks a folder).
            A still recorded with out: "x" goes to the folder demo.outputs.x names; one with
            publish: false is left where it is
  layout    "phone-captions" first puts each phone frame beside its caption list, in the
            colours of the film's theme (needs electron and @playwright/test in the plugin,
            like the e2e tests)

A file is written to a temporary name and moved into the output folder when it is
complete, so a failed encode keeps the previous file. The command never deletes media.

Checks, as "!" lines unless noted:
  size      a file above 2 MB warns, above 10 MB fails (the limit GitHub puts on images
            and GIFs attached to issues and pull requests)
  loop      the film's last frame should equal its first, or the GIF jumps on repeat;
            loop: "fail" makes it an error, "off" skips it
  hold      a frame held for less than one GIF frame can be skipped by the GIF
  density   frames shot below scale 2, or sizes that do not match the scale
  pair      a -light or -dark film whose partner film is missing
  stale     media in the output folder with no film or still behind it (never deleted)

Needs ffmpeg for films: on PATH, or its path in OPDK_FFMPEG. No audio, no intro or outro
cards. Without names every complete film is encoded and every still copied; a name selects
the film and the still of that name. Exit 1 when anything fails: no films and no stills, a
name that is neither a film nor a still, an incomplete film named on the command line,
without names no complete film among the recorded films, an unusable manifest,
a missing ffmpeg, an encode, a still that cannot be copied or would overwrite a film's file,
or a check set to fail.

Settings come from opdk.config.mjs ("demo" section): outDir, output, stills, outputs, films, and gif, mp4,
poster, layout, budget, loop, phone for all films or per film under films.<name>.
`;

export const demoCommand: Command = {
    name: "demo",
    summary: "Turn recorded demo films into MP4, GIF and poster files",
    usage: demoUsage,
    async run(args, ctx) {
        const { names } = parseDemoArgs(args);
        const config = await loadConfig(ctx.cwd);
        // Loaded here: the encoder code is not needed by any other command or by `opdk --help`.
        const { runDemo } = await import("./run.js");
        return runDemo({
            cwd: ctx.cwd,
            env: ctx.env,
            names,
            config: config.demo ?? {},
            reporter: ctx.reporter,
            source: `${CONFIG_FILE_NAME} "demo" section`,
        });
    },
};

export const demoCommands: readonly Command[] = [demoCommand];
