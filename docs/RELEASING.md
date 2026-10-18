# Releases

`package.json` supplies the current version. The script updates both npm version fields, Tauri, the DRC Cargo package, its lockfile entry and the README. Dependency versions and historical test records are left intact.

1. Write the changes as a short list in `docs/RELEASE-NOTES.md`, then commit the feature work.
2. On macOS, preview: `npm run release -- patch --dry-run`.
3. Release: `npm run release -- patch --publish`. `minor`, `major` or an explicit `X.Y.Z` also work.

The release command requires a clean checkout. It runs tests, builds the app, captures screenshots and regenerates the README. With `--publish`, it creates a version commit and pushes the branch. GitHub creates the annotated tag after its checks and package builds pass.

Omit `--publish` for local preparation. To publish that prepared version after review, commit the generated files and push the default branch. If the script's push fails, it retains the local commit and prints the retry command.

## GitHub Actions

`Checks` runs on ordinary branch pushes, pull requests and manual dispatch. It checks metadata, frontend, release scripts, native macOS code and Linux code.

After successful `Checks` on the default branch, `Desktop packages` checks the source version at that exact commit. A new version builds macOS arm64 and Debian/Fedora amd64 and arm64 packages, verifies installation and Linux recovery evidence, then creates `vX.Y.Z` and publishes the release assets. A failed job prevents publication. An already published version produces a “No new release” summary without rebuilding packages.

To retry, run `Desktop packages` manually from the default branch after `Checks` succeeds for that commit. The manual run uses the same release rules. An unpublished tag can be retried only at its original commit; the workflow never moves a tag or overwrites a published release. Increase the source version for changed code after tagging.

## Screenshots

`npm run screenshots` builds and runs the actual macOS app, then captures the disk overview, files in a generated FAT16 image, and the command reference. It uses a separate session store. It does not run disk tests, physical acquisition or source writes. The app captures its complete visible view and its actual native window controls; Accessibility and Screen Recording permissions are not required.

Before capturing, the driver checks storage navigation, opening both output tabs, intermediate animation frames and terminal preservation. Reduced Motion skips the animation-frame assertion.

Screenshots and a version/hash manifest are stored in `docs/images/`. The README is generated from `docs/README.template.md`; edit that template, then run `npm run readme`. Standard Shields.io badge URLs use the source version, npm/Cargo lockfiles and native language settings. `npm run readme:check` rejects stale text, badge versions and changed image files. Captures are made locally before tagging, so Linux CI needs no display or screenshot permissions.

`npm run version:check` checks all current version fields. `npm run copy:check` rejects a small list of recurring filler phrases and oversized release notes. Text still needs a human review for meaning and accuracy.

`npm run public:check` rejects known internal reference files and links in public documents. Release preparation and CI run this check. Internal inputs stay in ignored local storage, outside Docker build contexts and application resources; review new files for private content before committing.

The editable app icon is `public/drc-icon.svg`. Run `npm run icons` after editing it to generate the desktop formats and the matching README asset. Bug captures stay in ignored local storage.
