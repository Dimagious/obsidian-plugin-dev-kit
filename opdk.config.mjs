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
        layout: "phone-captions",
        phone: { title: "obsidian-plugin-dev-kit" },
    },
};
