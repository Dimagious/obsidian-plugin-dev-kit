/** Film names given on the command line; every other argument is an error, so a typo in a flag never passes for a name. */
export function parseDemoArgs(args: readonly string[]): { names: string[] } {
    const names: string[] = [];
    for (const arg of args) {
        if (arg.startsWith("-")) {
            throw new Error(`"opdk demo" has no option "${arg}". It takes film names; see "opdk demo --help".`);
        }
        if (!names.includes(arg)) {
            names.push(arg);
        }
    }
    return { names };
}
