/** How the text is split into compositions: one per word (with its trailing space), or one per character. */
export type CompositionChunking = "word" | "character";

/** One composition: the strings shown while it is in progress, then the text that commits it. */
export interface CompositionStep {
    readonly progress: readonly string[];
    readonly commit: string;
}

/**
 * Splits `text` into the compositions an input method would produce. Each composition grows one character at a
 * time (`h`, `he`, `hel`...) and is committed with the whole chunk. A word's trailing whitespace belongs to its
 * commit, the way a keyboard commits a word together with its space; whitespace on its own is a chunk too.
 */
export function planComposition(text: string, chunking: CompositionChunking): CompositionStep[] {
    const chunks = text.match(chunking === "character" ? /./gsu : /\S+\s*|\s+/gu) ?? [];
    return chunks.map((chunk) => {
        // The trailing space is committed, not composed; a chunk that is only whitespace is composed as it is.
        const composed = chunk.trimEnd() || chunk;
        const progress: string[] = [];
        let prefix = "";
        for (const character of composed) {
            prefix += character;
            progress.push(prefix);
        }
        return { progress, commit: chunk };
    });
}
