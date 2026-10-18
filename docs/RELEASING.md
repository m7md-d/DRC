# Releases

`package.json` supplies the current version. The script updates both npm version fields, Tauri, the DRC Cargo package, its lockfile entry and the README. Dependency versions and historical test records are left intact.

1. Write the changes as a short list in `docs/RELEASE-NOTES.md`, then commit the feature work.
2. On macOS, preview: `npm run release -- patch --dry-run`.
3. Release: `npm run release -- patch --publish`. `minor`, `major` or an explicit `X.Y.Z` also work.

The release command requires a clean checkout. It runs tests, builds the app, captures screenshots, regenerates the README, creates a release commit and annotated tag, and pushes the branch/tag atomically. GitHub builds macOS and Debian/Fedora packages, verifies the tag version and publishes after the required jobs pass. A failed build does not publish a release.

Omit `--publish` for local preparation. To publish that prepared version after review, commit the generated files, create the matching annotated `vX.Y.Z` tag, then push branch and tag together. If the script's final push fails, it prints the exact retry command; it retains the local commit and tag.

## Screenshots

`npm run screenshots` builds and runs the actual macOS app, then captures the disk overview, files in a generated FAT16 image, and the command reference. It uses a separate session store. It does not run disk tests, physical acquisition or source writes. The app captures its complete visible view and its actual native window controls; Accessibility and Screen Recording permissions are not required.

Before capturing, the driver checks storage navigation, opening both output tabs, intermediate animation frames and terminal preservation. Reduced Motion skips the animation-frame assertion.

Screenshots and a version/hash manifest are stored in `docs/images/`. The README is generated from `docs/README.template.md`; edit that template, then run `npm run readme`. Standard Shields.io badge URLs use the source version, npm/Cargo lockfiles and native language settings. `npm run readme:check` rejects stale text, badge versions and changed image files. Captures are made locally before tagging, so Linux CI needs no display or screenshot permissions.

`npm run version:check` checks all current version fields. `npm run copy:check` rejects a small list of recurring filler phrases and oversized release notes. Text still needs a human review for meaning and accuracy.

The editable app icon is `public/drc-icon.svg`. Run `npm run icons` after editing it to generate the desktop formats and the matching README asset. Bug captures stay in ignored local storage.
