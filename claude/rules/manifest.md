---
paths: ["manifest.json", "versions.json", "package.json", "package-lock.json"]
---

# Manifest and versions

- The `description` in `manifest.json` must not start with the plugin name (`manifest-description-no-name-prefix` in `opdk scan`).
- `opdk release X.Y.Z` owns the version in `package.json`, `package-lock.json`, `manifest.json` and `versions.json`. Do not edit those versions by hand: `opdk release check` fails when they disagree.
- `opdk release check` fails when the code calls an Obsidian API newer than `minAppVersion`. Either guard the call with `requireApiVersion("X.Y.Z")`, or raise `minAppVersion` and add the new version to `versions.json`.

Details: `node_modules/obsidian-plugin-dev-kit/docs/release.md`.
