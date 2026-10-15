# DRC 0.4.3 verification — 15 October 2026

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
