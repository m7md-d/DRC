# DRC verification — 15 October 2026

## 0.4.5 macOS native menu bar

- SwiftUI renders the panel inside an AppKit NSStatusItem / transient NSPopover, hosted by NSHostingController and statically linked into the same Rust executable. Apple controls, system fonts, SF Symbols and Swift Charts replace the earlier webview panel. There is no second application or menu webview capability.
- Each native DisclosureGroup binds to its own expanded state. Host sampling and reopening retain branch state; original fields remain available through the workspace. The main window and its session/connection watcher remain alive when hidden. Quit uses the acquisition/extraction stop-and-save guard.
- Host samples use fixed sysctl keys, Mach CPU/VM counters, IOPowerSources descriptions and published IOBlockStorageDriver counters. No disk descriptor, SMART, self-test, benchmark or sector read is used for sampling. Disk/port refresh remains an explicit metadata action subject to the existing query gate.
- The menu cache receives live backend observations independently of the historical session in the main window. Readings include timestamps and exact byte strings. Driver-instance changes, reduced counters and hidden intervals leave gaps instead of fabricated throughput.
- The compact panel is 360×400 logical points, with a shorter height on constrained displays. System cards use 28-point charts and additional counters expand under More readings; disk SMART details are collapsed initially. The content scrolls inside the panel.
- On the M1 production app, the native accessibility tree exposes a popover, segmented radio buttons and disclosure triangles (no HTML surface for the panel). USB and NVMe/controller branches change between on/off, remove/show children and retain their states after reopening. System/Disks navigation, passive live activity, More readings and tab scroll reset were checked. The 360×400 panel shows the full summary and footer. No SMART or physical-source data read was used.
- Twenty frontend tests and 39 macOS Rust tests pass. The standalone Swift model suite passes 24 checks covering exact deltas beyond JavaScript precision, missing/reset/reconnected counters, monotonic intervals, memory/byte formatting and hub/enclosure/media topology. Swift compilation rejects warnings; Rust Clippy passes with warnings denied.
- A local Debian 12 arm64 0.4.5 package built successfully: 20 frontend / 39 Rust tests, Clippy with warnings denied and all 12 generated-file fault/resume cases passed. The package and checksum are in `artifacts/linux-0.4.5`; this is local evidence, not a published release or amd64 validation.
- The `macos-menu-bar` Cargo feature is enabled by macOS build/test wrappers only. Linux packaging does not invoke Swift or link AppKit/SwiftUI/Charts. Published 0.4.3 Linux CI evidence below remains version-specific; local package checks do not imply physical hardware validation.

## 0.4.3 acquisition baseline

## Native packages

- macOS arm64 release bundle with embedded production assets, copied to the project-root `DRC.app`. Local ad-hoc signing and deep/strict verification pass. Developer ID signing and notarization remain unavailable.
- Debian 12 arm64 package built in an isolated Linux container. A fresh Debian runtime image installs the package through APT and resolves the private image-reader library without development headers. GNU ddrescue reports 1.30; Sleuth Kit reports 4.11.1.
- GitHub Actions builds and checks amd64 and arm64 independently. A tagged release is published only after both jobs succeed. Local arm64 evidence does not imply local amd64 or physical-hardware validation.
- Linux desktop UI, UDisks2 authentication prompts and dedicated physical-disk acquisition still require a real desktop test. Ubuntu and Mint are command-reference profiles, not independently validated package targets.

## Automated checks

- Production TypeScript check and frontend build pass. Twenty frontend tests cover exact numeric fields, paths, SMART flags, map coverage, inert terminal escapes and the offline reference's OS profiles, effects and searchable flags.
- Thirty-eight macOS Rust tests and thirty-nine Linux Rust tests pass. Coverage includes descriptor/protection checks, layered hardware backing, no-namespace host evidence, returned descriptor restrictions, acquisition/map verification, controlled stop/resume and image extraction.
- Rust Clippy passes with warnings denied on both hosts.
- The session-lock regression was reproduced before the fix by retaining a duplicate of the open lock descriptor. After the fix, reopening succeeds while the duplicate remains alive, and a concurrent second store is still refused. This covers the helper-inheritance race exposed by the 0.4.1 arm64 CI job.
- GNU ddrescue tests use generated regular images. Simulated unreadable regions cannot become a falsely complete image merely because the output has full length.
- The Linux fault harness exercises short/interrupted reads, early EOF, EIO/ENXIO/ENODEV after a readable prefix, a delayed read overlapping a stop request, destination/map ENOSPC and destination EIO, small requests and 4096-byte alignment. After removing each injected fault, the same image/map pair resumes in reverse and matches the position-unique source bytes exactly. Source hashes stay unchanged. Original streams and mapfiles are recorded in `linux-fault-results-ARCH.json` release assets.
- The kernel harness uses an owned generated read-only loop image. Mounting while exclusively claimed is refused, claiming a mounted source returns EBUSY and writing through the read-only descriptor returns EBADF. Source hash stays unchanged. Its scope and results are recorded in `linux-kernel-results-ARCH.json` release assets.
- Image-reader tests use generated MBR/FAT16 images with allocated, deleted, Unicode and fragmented binary files. An NTFS/exFAT recovery corpus has not been validated.

- Port-topology tests retain hub/enclosure observations with no invented SSD, preserve reported media/port children, verify required versus available USB current labels and reject cyclic or guessed ancestry. Unknown node fields remain intact.

- New regression checks retain partial-map prefixes without invented tail statuses, keep the local journal after destination replacement, drain failed transcripts while preserving a healthy copy, handle split/repeated abort prompts without matching incomplete text, exercise an actual pipe peer with recorded q+Enter responses, bound read controls and reject injected SMART transport arguments.

## Native-window checks

- Own macOS window, production content at `tauri://localhost`, English interface and local session persistence.
- Easy and Professional share the same session and source policy. Easy exposes inspection, imaging and exploration while retaining access to all original fields and command output.
- Port map verified using a previous saved USB/media hierarchy and a new live System Profiler/IORegistry report. Required/available current remain distinguished from actual electrical measurements.
- Native wide and portrait layouts and exact-byte focus hints checked.
- Reference OS/profile switching, category/search filtering, custom keyboard-operable selector, independent pane scrolling and inert copy-only examples checked in the native window.
- Protected personal media remain metadata-only; SMART, traversal and imaging admission are disabled. Discovery is independent of filesystem support.
- Physical-source admission requires a positively external medium on macOS. Linux separately resolves non-system hardware backing, including secondary internal SATA/NVMe, excludes system/swap and mounted sources, and holds a read-only exclusive descriptor.

No acquisition, sector scan, SMART self-test, filesystem traversal or destination write was performed on the owner's personal flash. The unavailable faulty Samsung SSD was not tested. Controlled userspace faults and loop-device tests do not validate electrical instability, damaged controllers/NAND, real reconnects or uninterruptible kernel reads. See [SSD resilience](SSD-RESILIENCE.md) for evidence and remaining boundaries.
