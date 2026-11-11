// Settings of `opdk demo` for the film in README.md (docs/media/demo.gif), recorded by
// test/e2e-fixture/e2e/docs-film.spec.ts. Run both with `npm run docs:media:demo`.
export default {
    demo: {
        outDir: ".opdk/demo",
        output: "docs/media",
        // README needs the GIF only; the repository stays small.
        mp4: false,
        poster: false,
        gif: { width: 900 },
        // The film ends where it began. The loop check still sees a difference of one level out of 255 in the
        // active line's background (invisible), so the check is off.
        loop: "off",
        layout: "phone-captions",
        phone: { title: "obsidian-plugin-dev-kit" },
    },
};
