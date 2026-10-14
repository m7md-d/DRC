# Local build verification — 13 October 2026

## Packaged application

- macOS arm64 release bundle: `src-tauri/target/release/bundle/macos/DRC.app`, with a standalone copy at `DRC.app` in the project root.
- Embedded production assets; no browser or development server required.
- Local ad-hoc bundle signing and deep/strict verification succeeded. This is not Developer ID distribution signing or notarization.
- Interface-owned copy was checked for English-only text. Source-reported localized values are preserved.

## Automated checks

- Frontend production type check and build passed.
- Five frontend tests passed: complete field retention, unambiguous paths, exact byte arithmetic, SMART flag decoding and inert terminal escape sequences.
- Six Rust tests passed: large protocol counters, plist field preservation, hostile identifier rejection, fixed SMART query flags, changed device descriptors and nonzero SMART status preservation.
- Rust Clippy passed with warnings denied.
- Dependency audit reported zero known vulnerabilities at verification time.
- README and implementation-document local links were checked.

## Native-window checks

- Application opened in its own macOS window using `tauri://localhost` embedded content.
- Three physical devices were reported: two USB devices and one internal device.
- A connected NTFS partition was displayed from actual diskutil data, including its original layout fields.
- Filtering layout fields reduced the visible count from 10 to 1 and displayed 9 filtered fields; clearing the filter restored all 10.
- Copy session JSON completed in the native window.
- A requested USB/Thunderbolt host report completed with exit 0 and exposed all 75 returned fields.
- Connection watching could be disabled, and no diskutil activity child remained after quitting the test instance.
- Read-only policy disclosed the distinction between DRC's metadata allowlist and unestablished system-wide/hardware write blocking.
- The policy dialog moved keyboard focus into the dialog and closed with Escape in the final native build.

No SMART query, filesystem mount/unmount, file traversal, sector scan, acquisition, self-test or write operation was run on the user's external media during these checks. The readings above describe this machine's test session, not fixed application demo data.

## Remaining release work

Raw acquisition with resume, filesystem extraction, persistent cases, privileged-helper design, dedicated test-device write operations, other host backends, telemetry instruments and distribution signing are separate implementation stages. Their absence is explicit in the application.
