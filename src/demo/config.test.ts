import { describe, expect, it } from "vitest";
import {
    assertCssValue,
    baseFilmName,
    DEFAULT_FAIL_BYTES,
    DEFAULT_WARN_BYTES,
    demoFolders,
    resolveFilmSettings,
    validateDemoConfig,
} from "./config.js";

const SRC = "opdk.config.mjs";

describe("validateDemoConfig", () => {
    it("accepts an empty section", () => {
        expect(validateDemoConfig({}, SRC)).toEqual({});
    });

    it("copies every documented key", () => {
        const config = {
            outDir: "out",
            output: "media",
            gif: { width: 800, colors: 64, fps: 8 },
            mp4: false,
            poster: { width: 1200 },
            layout: "phone-captions",
            budget: { warnBytes: 100, failBytes: 200 },
            loop: "off",
            phone: {
                background: "#fff",
                text: "#000",
                muted: "#888",
                accent: "#0af",
                font: 'Inter, "Segoe UI", sans-serif',
                title: "Tour <1>\nline two",
                light: { accent: "#6f4fe0" },
                dark: { background: "#191722", text: "rgba(255,255,255,.9)" },
            },
            films: { tour: { gif: false, layout: "plain", poster: false, loop: "fail", budget: { failBytes: 5 }, phone: { dark: { accent: "#a48cff" } } } },
        };
        expect(validateDemoConfig(config, SRC)).toEqual(config);
    });

    it.each([
        [{ nope: 1 }, /unknown key\(s\) in "demo": nope\. Allowed keys: gif, mp4, poster, layout, budget, loop, phone, outDir, output, films\./],
        [[], /"demo" must be an object/],
        [{ outDir: "" }, /"demo.outDir" must be a non-empty string/],
        [{ output: 3 }, /"demo.output" must be a non-empty string/],
        [{ loop: "maybe" }, /"demo.loop" must be one of: "warn", "fail", "off"/],
        [{ layout: "wide" }, /"demo.layout" must be one of: "plain", "phone-captions"/],
        [{ mp4: "yes" }, /"demo.mp4" must be true or false/],
        [{ poster: 1 }, /"demo.poster" must be an object \(\{ width \}\) or true or false/],
        [{ poster: { height: 3 } }, /unknown key\(s\) in "demo.poster": height/],
        [{ poster: { width: 4 } }, /"demo.poster.width" must be a whole number from 16 to 8000/],
        [{ films: { a: { loop: "never" } } }, /"demo.films\["a"\].loop" must be one of/],
        [{ gif: true }, /"demo.gif" must be an object \(\{ width, colors, fps \}\) or false/],
        [{ gif: { colour: 1 } }, /unknown key\(s\) in "demo.gif": colour/],
        [{ gif: { colors: 1 } }, /"demo.gif.colors" must be a whole number from 2 to 256/],
        [{ gif: { colors: 300 } }, /"demo.gif.colors" must be a whole number from 2 to 256/],
        [{ gif: { fps: 0 } }, /"demo.gif.fps" must be a whole number from 1 to 50/],
        [{ gif: { width: 10.5 } }, /"demo.gif.width" must be a whole number/],
        [{ budget: 3 }, /"demo.budget" must be an object/],
        [{ budget: { warnBytes: 10, failBytes: 5 } }, /warnBytes" \(10\) must not be above "failBytes" \(5\)/],
        [{ budget: { warnBytes: -1 } }, /"demo.budget.warnBytes" must be a whole number/],
        [{ phone: "dark" }, /"demo.phone" must be an object/],
        [{ phone: { color: "red" } }, /unknown key\(s\) in "demo.phone": color/],
        [{ phone: { accent: "red; } body { display:none" } }, /"demo.phone.accent" must be a CSS value without ";"/],
        [{ phone: { font: "a</style>" } }, /"demo.phone.font" must be a CSS value without "<"/],
        [{ phone: { light: "red" } }, /"demo.phone.light" must be an object/],
        [{ phone: { dark: { font: "x" } } }, /unknown key\(s\) in "demo.phone.dark": font/],
        [{ phone: { dark: { accent: "red\\a" } } }, /"demo.phone.dark.accent" must be a CSS value without "\\\\"/],
        [{ phone: { dark: { text: "" } } }, /"demo.phone.dark.text" must be a non-empty string/],
        [{ films: { a: { phone: { light: { muted: "url(x)" } } } } }, /"demo.films\["a"\].phone.light.muted" must be a CSS value without "url\("/],
        [{ films: [] }, /"demo.films" must be an object keyed by film name/],
        [{ films: { tour: 1 } }, /"demo.films\["tour"\]" must be an object/],
        [{ films: { tour: { outDir: "x" } } }, /unknown key\(s\) in "demo.films\["tour"\]": outDir/],
        [{ films: { tour: { films: {} } } }, /unknown key\(s\) in "demo.films\["tour"\]": films/],
        [{ films: { tour: { gif: { colors: 0 } } } }, /"demo.films\["tour"\].gif.colors" must be a whole number/],
    ])("rejects %j", (config, message) => {
        expect(() => validateDemoConfig(config, SRC)).toThrow(message);
    });

    it("names the config source in every message", () => {
        expect(() => validateDemoConfig({ loop: 1 }, "/p/opdk.config.mjs")).toThrow(/^\/p\/opdk\.config\.mjs: /);
    });

    it("leaves the title unrestricted: it is text, escaped when the page is built", () => {
        expect(validateDemoConfig({ phone: { title: "A { B } <c>" } }, SRC).phone?.title).toBe("A { B } <c>");
    });

    it("accepts poster true as the default poster", () => {
        expect(validateDemoConfig({ poster: true }, SRC).poster).toBe(true);
        expect(validateDemoConfig({ poster: {} }, SRC).poster).toEqual({});
    });
});

describe("assertCssValue", () => {
    it("passes colours and font lists", () => {
        expect(assertCssValue("rgba(0,0,0,.5)", "x")).toBe("rgba(0,0,0,.5)");
        expect(assertCssValue("#6f4fe0", "x")).toBe("#6f4fe0");
        expect(assertCssValue('"Segoe UI", sans-serif', "x", "font")).toBe('"Segoe UI", sans-serif');
        expect(assertCssValue("'Fira Sans', \"Droid Sans\"", "x", "font")).toBe("'Fira Sans', \"Droid Sans\"");
    });

    it.each([";", "{", "}", "<", ">", "\\"])("rejects %s in a colour and in a font", (char) => {
        expect(() => assertCssValue(`a${char}b`, "the value")).toThrow(/the value must be a CSS value without/);
        expect(() => assertCssValue(`a${char}b`, "the value", "font")).toThrow(/the value must be a CSS value without/);
    });

    it.each(["a/*b", "a/*", "URL(x)", "url(http://x)", "x url( y"])("rejects the comment or request %s", (value) => {
        expect(() => assertCssValue(value, "the value")).toThrow(/without "(\/\*|url\(|URL\()"/);
    });

    it.each(['"', "'", 'a"b', "a'b", "red 'x'"])("rejects quotes in a colour: %s", (value) => {
        expect(() => assertCssValue(value, "the value")).toThrow(/without quotes/);
    });

    it.each(['"Segoe UI', "Inter, 'x", '"a" "b', "'a'b'"])("rejects quotes that are not in pairs in a font: %s", (value) => {
        expect(() => assertCssValue(value, "the value", "font")).toThrow(/with quotes in pairs/);
    });
});

describe("demoFolders", () => {
    it("defaults to the fixture's output folder and docs/screens, where the plugins keep their media", () => {
        expect(demoFolders({})).toEqual({ outDir: ".opdk/demo", output: "docs/screens" });
        expect(demoFolders({ outDir: "o", output: "p" })).toEqual({ outDir: "o", output: "p" });
    });
});

describe("baseFilmName", () => {
    it("strips the theme suffix of a themed film only", () => {
        expect(baseFilmName("tour-dark", "dark")).toBe("tour");
        expect(baseFilmName("tour-light", "light")).toBe("tour");
        expect(baseFilmName("tour-dark", "light")).toBe("tour-dark");
        expect(baseFilmName("tour-dark", null)).toBe("tour-dark");
    });
});

describe("resolveFilmSettings", () => {
    it("starts from the documented defaults", () => {
        expect(resolveFilmSettings({}, "tour", null, SRC)).toEqual({
            gif: { width: null, colors: 128, fps: null },
            mp4: true,
            poster: { width: null },
            layout: "plain",
            budget: { warnBytes: DEFAULT_WARN_BYTES, failBytes: DEFAULT_FAIL_BYTES },
            loop: "warn",
            phone: [],
        });
        expect(DEFAULT_WARN_BYTES).toBe(2 * 1024 * 1024);
        expect(DEFAULT_FAIL_BYTES).toBe(10 * 1024 * 1024);
    });

    it("layers the top level, the base name of a theme pair, then the exact name", () => {
        const config = validateDemoConfig(
            {
                gif: { colors: 64, fps: 6 },
                mp4: false,
                films: {
                    tour: { gif: { width: 700 }, layout: "phone-captions" },
                    "tour-dark": { gif: { colors: 32 }, mp4: true },
                },
            },
            SRC,
        );
        expect(resolveFilmSettings(config, "tour-light", "light", SRC)).toMatchObject({
            gif: { width: 700, colors: 64, fps: 6 },
            mp4: false,
            layout: "phone-captions",
        });
        expect(resolveFilmSettings(config, "tour-dark", "dark", SRC)).toMatchObject({
            gif: { width: 700, colors: 32, fps: 6 },
            mp4: true,
            layout: "phone-captions",
        });
        expect(resolveFilmSettings(config, "other", null, SRC)).toMatchObject({ gif: { width: null, colors: 64, fps: 6 }, layout: "plain" });
    });

    it("lets a film turn the GIF off and a later layer turn it back on with defaults", () => {
        expect(resolveFilmSettings({ films: { a: { gif: false } } }, "a", null, SRC).gif).toBeNull();
        expect(resolveFilmSettings({ gif: false, films: { a: { gif: { width: 500 } } } }, "a", null, SRC).gif).toEqual({ width: 500, colors: 128, fps: null });
    });

    it("layers the poster, the loop mode and the phone entries; false turns the poster off and a later layer turns it on", () => {
        const config = validateDemoConfig(
            {
                loop: "off",
                poster: { width: 900 },
                phone: { accent: "#111111" },
                films: {
                    tour: { poster: false, loop: "fail", phone: { dark: { accent: "#222222" } } },
                    "tour-dark": { poster: { width: 500 }, phone: { text: "#333333" } },
                },
            },
            SRC,
        );
        const dark = resolveFilmSettings(config, "tour-dark", "dark", SRC);
        expect(dark.poster).toEqual({ width: 500 });
        expect(dark.loop).toBe("fail");
        // Weakest first: demo, the base entry, the exact entry.
        expect(dark.phone).toEqual([{ accent: "#111111" }, { dark: { accent: "#222222" } }, { text: "#333333" }]);
        const light = resolveFilmSettings(config, "tour-light", "light", SRC);
        expect(light.poster).toBeNull();
        expect(resolveFilmSettings(config, "other", null, SRC)).toMatchObject({ poster: { width: 900 }, loop: "off", phone: [{ accent: "#111111" }] });
        expect(resolveFilmSettings({ poster: false, films: { a: { poster: true } } }, "a", null, SRC).poster).toEqual({ width: null });
    });

    it("does not read Object.prototype members as overrides", () => {
        expect(resolveFilmSettings({}, "constructor", null, SRC).mp4).toBe(true);
    });

    it("fails when a film's merged budget has the warn limit above the fail limit", () => {
        const config = validateDemoConfig({ budget: { warnBytes: 100, failBytes: 200 }, films: { a: { budget: { failBytes: 50 } } } }, SRC);
        expect(() => resolveFilmSettings(config, "a", null, SRC)).toThrow(/film "a" has warnBytes \(100\) above failBytes \(50\)/);
    });
});
