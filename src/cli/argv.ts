export type ParsedArgv =
    | { readonly kind: "help" }
    | { readonly kind: "version" }
    | { readonly kind: "command-help"; readonly name: string }
    | { readonly kind: "run"; readonly name: string; readonly args: readonly string[] };

const isHelpFlag = (arg: string): boolean => arg === "--help" || arg === "-h";

/** Pure argv parsing (argv without the node and script entries). Does not know which commands exist. */
export function parseArgv(argv: readonly string[]): ParsedArgv {
    const [first, ...rest] = argv;
    if (first === undefined || isHelpFlag(first)) {
        return { kind: "help" };
    }
    if (first === "--version") {
        return { kind: "version" };
    }
    // Everything after a bare "--" belongs to the command, including a literal -h.
    const separator = rest.indexOf("--");
    const ownArgs = separator === -1 ? rest : rest.slice(0, separator);
    if (ownArgs.some(isHelpFlag)) {
        return { kind: "command-help", name: first };
    }
    return { kind: "run", name: first, args: rest };
}
