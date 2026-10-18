# DRC project rules

- Product UI is English. Follow `BRAND-SYSTEM.md` with native macOS proportions and functional, clearly visible state colors.
- Write direct, factual text in UI, tooltips, README and release notes. Name the action, result or limitation. No slogans, sales copy, motivational language, self-praise or generic LLM filler. Do not repeat the same warning across nearby elements.
- Preserve exact readings, original tool output, error codes and uncertainty. Concise wording must not remove information needed to decide an operation or imply a hardware diagnosis.
- README covers functions, installation and useful screenshots. Release notes list concrete changes and relevant breaking changes; test inventories belong in `docs/BUILD_CHECKS.md`.
- Keep the README header's source version, platforms, downloads and technology information when changing its visual style. Do not add release or build-status badges unless explicitly requested.
- Use conventional Shields.io flat badges in README headers. Do not design custom badge SVGs, grids or dashboard cards. Source versions come from project metadata, dependency versions from lockfiles and language settings from build configuration. The license badge is GPL v3 and links to `LICENSE`; the owner supplies that file.
- Easy and Professional adapt the current task without navigating away or clearing input, selected files, reports, source bindings or pending reviews. Easy uses shorter task menus, guided actions and readable observations; hiding controls alone is not an Easy interface. Apply the selected mode to every workspace and device section. Keep important operations, original evidence and errors accessible in both modes.
- Public images must show complete, functional views. Keep bug reproductions and unfinished captures under ignored local storage; never stage them as documentation assets.
- Screenshots must come from the running desktop app. Use generated image files for file-reading examples; do not start disk tests, imaging, resets or writes on connected personal media to obtain screenshots.
- Use the release/version scripts for current version numbers and generated README sections. Historical version numbers in validation records remain historical.
- Do not discard staged or unrelated changes. No version bump, commit, tag or push unless the requested work calls for that action.
