import { describe, expect, it } from "vitest";
import {
    buildPhonePage,
    captionSteps,
    escapeHtml,
    OBSIDIAN_FONT,
    PAGE_HEIGHT,
    PAGE_SCALE,
    PAGE_WIDTH,
    resolvePhoneLayout,
} from "./phone-layout.js";

describe("page geometry", () => {
    it("is a 1000 x 620 page rendered at 2x", () => {
        expect([PAGE_WIDTH, PAGE_HEIGHT, PAGE_SCALE]).toEqual([1000, 620, 2]);
    });
});

describe("resolvePhoneLayout", () => {
    it("uses neutral colours and Obsidian's font stack by default, light and dark sets apart", () => {
        const light = resolvePhoneLayout([], "light");
        const dark = resolvePhoneLayout([], "dark");
        expect(light.font).toBe(OBSIDIAN_FONT);
        expect(light.title).toBeNull();
        expect(light.background).not.toBe(dark.background);
        expect(dark.background).toBe("#191722");
        expect(resolvePhoneLayout([], null)).toEqual(light);
    });

    it("takes what the plugin sets and keeps the rest", () => {
        const layout = resolvePhoneLayout([{ accent: "#ff0066", title: "Tour" }], null);
        expect(layout.accent).toBe("#ff0066");
        expect(layout.title).toBe("Tour");
        expect(layout.text).toBe(resolvePhoneLayout([], null).text);
    });

    it("a flat colour applies to both themes; a theme entry overrides it for its theme only", () => {
        const phone = { accent: "#111111", muted: "#222222", dark: { accent: "#999999" }, light: { muted: "#aaaaaa" } };
        expect(resolvePhoneLayout([phone], "light")).toMatchObject({ accent: "#111111", muted: "#aaaaaa" });
        expect(resolvePhoneLayout([phone], "dark")).toMatchObject({ accent: "#999999", muted: "#222222" });
        // The dark defaults remain for what nothing sets.
        expect(resolvePhoneLayout([phone], "dark").background).toBe(resolvePhoneLayout([], "dark").background);
    });

    it("a film without a theme reads the flat colours and ignores the theme entries", () => {
        const layout = resolvePhoneLayout([{ accent: "#111111", dark: { accent: "#999999" }, light: { accent: "#888888" } }], null);
        expect(layout.accent).toBe("#111111");
    });

    it("merges layers in order: demo, then the base film entry, then the exact film entry; within a layer the theme entry wins", () => {
        const layers = [
            { background: "#000001", text: "#000002", font: "A", title: "T1", dark: { text: "#0000d2" } },
            { background: "#000011", dark: { background: "#0000d1", muted: "#0000d3" } },
            { text: "#000022", title: "T3" },
        ];
        expect(resolvePhoneLayout(layers, "dark")).toMatchObject({
            // The theme entry of layer 2 beats the flat colour of layer 2 and everything before it.
            background: "#0000d1",
            // Layer 3's flat text beats layer 1's theme entry: a later layer wins over an earlier one.
            text: "#000022",
            muted: "#0000d3",
            font: "A",
            title: "T3",
        });
        expect(resolvePhoneLayout(layers, "light")).toMatchObject({ background: "#000011", text: "#000022", muted: resolvePhoneLayout([], "light").muted });
    });
});

describe("escapeHtml", () => {
    it("escapes the five characters that matter", () => {
        expect(escapeHtml(`<img src=x onerror="a()"> & 'q'`)).toBe("&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;q&#39;");
    });

    it("leaves plain text alone", () => {
        expect(escapeHtml("Paste the key")).toBe("Paste the key");
    });
});

describe("captionSteps", () => {
    const frame = (caption: number | null): { file: string; hold: number; caption: number | null } => ({ file: "0001.png", hold: 1, caption });

    it("highlights the frame's own caption, else the last one shown", () => {
        expect(captionSteps([frame(null), frame(0), frame(null), frame(1), frame(null), frame(0)])).toEqual([null, 0, 0, 1, 1, 0]);
    });

    it("is empty for no frames", () => {
        expect(captionSteps([])).toEqual([]);
    });
});

describe("buildPhonePage", () => {
    const layout = resolvePhoneLayout([{ title: `Tour <of> "the" plugin` }], null);
    const page = buildPhonePage({
        imageDataUrl: "data:image/png;base64,AAAA",
        captions: ["Open a note", `Type <b>bold</b> & "quotes"`, "Done"],
        step: 1,
        layout,
    });

    it("shows the picture, one list item per caption with the current step marked", () => {
        expect(page).toContain('<img class="phone" src="data:image/png;base64,AAAA">');
        expect(page.match(/<li/g)).toHaveLength(3);
        expect(page).toContain('<li class="on"><span class="n">2</span>');
        expect(page.match(/class="on"/g)).toHaveLength(1);
    });

    it("escapes captions and the title, so text cannot become markup", () => {
        expect(page).not.toContain("<b>bold</b>");
        expect(page).toContain("Type &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;");
        expect(page).toContain("<h1>Tour &lt;of&gt; &quot;the&quot; plugin</h1>");
    });

    it("marks no step when none is current, and leaves out the heading without a title", () => {
        const none = buildPhonePage({ imageDataUrl: "data:,", captions: ["a"], step: null, layout: resolvePhoneLayout([], null) });
        expect(none).not.toContain('class="on"');
        expect(none).not.toContain("<h1>");
    });

    it("puts the configured colours and font into the style", () => {
        const custom = buildPhonePage({
            imageDataUrl: "data:,",
            captions: ["a"],
            step: 0,
            layout: resolvePhoneLayout([{ background: "#102030", accent: "#abcdef", font: "Georgia, serif" }], null),
        });
        expect(custom).toContain("background:#102030");
        expect(custom).toContain("font-family:Georgia, serif");
        expect(custom).toContain("background:#abcdef");
    });

    it.each([
        ["background", "background"],
        ["text", "text"],
        ["muted", "muted colour"],
        ["accent", "accent"],
        ["font", "font"],
    ] as const)("refuses a %s that would end the rule, whatever reaches the page through the layout", (key, what) => {
        const page = (value: string): string => buildPhonePage({ imageDataUrl: "data:,", captions: [], step: null, layout: { ...layout, [key]: value } });
        expect(() => page("red;}</style><script>")).toThrow(new RegExp(`phone layout ${what} must be a CSS value without`));
        expect(() => page("url(http://x/y)")).toThrow(/without "url\("/);
    });

    it("splits a caption with a line break into a heading and a text, both escaped", () => {
        const two = buildPhonePage({ imageDataUrl: "data:,", captions: ["Tap a <day>\nSee its value & more", "Plain\n", "  Padded  "], step: 0, layout });
        expect(two).toContain("<span><b>Tap a &lt;day&gt;</b><i>See its value &amp; more</i></span>");
        // No text after the break, or no break: one line.
        expect(two).toContain("<span>Plain</span>");
        expect(two).toContain("<span>Padded</span>");
        expect(two.match(/<b>/g)).toHaveLength(1);
    });

    it("keeps a line break in the title", () => {
        const titled = buildPhonePage({ imageDataUrl: "data:,", captions: [], step: null, layout: resolvePhoneLayout([{ title: "Works on\nyour <phone>" }], null) });
        expect(titled).toContain("<h1>Works on<br>your &lt;phone&gt;</h1>");
    });
});
