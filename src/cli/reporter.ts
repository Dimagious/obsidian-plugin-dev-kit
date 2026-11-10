/**
 * The one place that decides how CLI output looks. Commands call the reporter instead of writing
 * `[step] text` themselves, so a glance tells which step passed (`✓`, green) and which failed (`✗`, red).
 *
 * Symbols stay in plain mode, so a CI log reads the same as a terminal, just without escape codes.
 * Errors go to stderr, everything else to stdout.
 */

export interface ColorEnv {
    readonly isTTY: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Whether a stream gets ANSI colour. Modelled on Node's `getColorDepth` and the supports-color package, with deliberate
 * differences (`NO_COLOR` beats `FORCE_COLOR`, an empty `NO_COLOR` is ignored, `GITHUB_ACTIONS` counts). In order:
 * - a non-empty `NO_COLOR` (no-color.org) turns it off;
 * - `FORCE_COLOR` set: `0` or `false` turn it off, anything else (an empty value included) turns it on, even
 *   on a pipe and even with `TERM=dumb`;
 * - `TERM=dumb` turns it off;
 * - `GITHUB_ACTIONS=true` turns it on, because the Actions log viewer renders ANSI;
 * - otherwise colour only when the stream is a terminal.
 */
export function shouldColor({ isTTY, env }: ColorEnv): boolean {
    const noColor = env.NO_COLOR;
    if (noColor !== undefined && noColor !== "") {
        return false;
    }
    const force = env.FORCE_COLOR;
    if (force !== undefined) {
        return force !== "0" && force !== "false";
    }
    if (env.TERM === "dumb") {
        return false;
    }
    if (env.GITHUB_ACTIONS === "true") {
        return true;
    }
    return isTTY;
}

// A table of SGR codes instead of `util.styleText`: there must be exactly one decision point, and `styleText`
// re-applies its own TTY and NO_COLOR check unless `validateStream: false` is passed. It also closes each
// attribute with its own reset, while the output here ends every painted span with one `ESC[0m`.
const SGR = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33 } as const;
type Style = keyof typeof SGR;

const RESET = "\u001b[0m";

function paint(text: string, styles: readonly Style[], color: boolean): string {
    if (!color || text === "") {
        return text;
    }
    return `\u001b[${styles.map((style) => String(SGR[style])).join(";")}m${text}${RESET}`;
}

/** Width of the step column. `bundle` is the longest step name the kit prints today. */
export const STEP_WIDTH = 6;

const SYMBOL = { success: "✓", failure: "✗", info: "·", warning: "!" } as const;

type Kind = keyof typeof SYMBOL;

const KIND_STYLE: Readonly<Record<Kind, Style>> = {
    success: "green",
    failure: "red",
    info: "dim",
    warning: "yellow",
};

export interface FailureExtras {
    /** Lines indented under the failure, in the failure colour. */
    readonly details?: readonly string[];
    /** What to do about it, indented under the details. */
    readonly hint?: string;
}

export interface Reporter {
    /** `✓ step  message` on stdout. */
    success(step: string, message: string): void;
    /** `· step  message` on stdout: progress that is neither a result nor a problem. */
    info(step: string, message: string): void;
    /** `! step  message` on stdout; a warning does not fail the command. */
    warn(step: string, message: string): void;
    /** `✗ step  message` on stderr, then the details and the hint. */
    failure(step: string, message: string, extras?: FailureExtras): void;
    /** `✗ message` on stderr, for errors that belong to no step (the CLI itself). Extra lines are indented. */
    error(message: string, details?: readonly string[]): void;
    /** Whether stderr gets colour; passed to esbuild so its own message layout matches. */
    readonly colorStderr: boolean;
    /** Text that is already formatted, such as esbuild's messages. Written as is. */
    rawStderr(text: string): void;
}

export interface ReporterOptions {
    stdout(text: string): void;
    stderr(text: string): void;
    readonly colorStdout: boolean;
    readonly colorStderr: boolean;
}

export function createReporter(options: ReporterOptions): Reporter {
    const { colorStdout, colorStderr } = options;
    const stdout = (text: string): void => {
        options.stdout(text);
    };
    const stderr = (text: string): void => {
        options.stderr(text);
    };
    const line = (out: (text: string) => void, color: boolean, kind: Kind, step: string, message: string): void => {
        const style = KIND_STYLE[kind];
        const symbol = paint(SYMBOL[kind], [style], color);
        const name = paint(step.padEnd(STEP_WIDTH), kind === "info" ? ["dim", "bold"] : ["bold", style], color);
        out(`${symbol} ${name}  ${paint(message, kind === "info" ? ["dim"] : [style], color)}\n`);
    };
    const indent = " ".repeat(STEP_WIDTH + 4);
    return {
        success: (step, message) => {
            line(stdout, colorStdout, "success", step, message);
        },
        info: (step, message) => {
            line(stdout, colorStdout, "info", step, message);
        },
        warn: (step, message) => {
            line(stdout, colorStdout, "warning", step, message);
        },
        failure: (step, message, extras = {}) => {
            line(stderr, colorStderr, "failure", step, message);
            for (const detail of extras.details ?? []) {
                stderr(`${indent}  ${paint(detail, ["red"], colorStderr)}\n`);
            }
            if (extras.hint !== undefined) {
                stderr(`${indent}${paint(extras.hint, ["yellow"], colorStderr)}\n`);
            }
        },
        error: (message, details = []) => {
            stderr(`${paint(SYMBOL.failure, ["red"], colorStderr)} ${paint(message, ["red"], colorStderr)}\n`);
            for (const detail of details) {
                stderr(`  ${paint(detail, ["red"], colorStderr)}\n`);
            }
        },
        colorStderr,
        rawStderr: (text) => {
            stderr(text);
        },
    };
}
