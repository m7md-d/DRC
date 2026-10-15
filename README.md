# DRC — Disk Recovery Control

DRC is a native desktop workspace for inspecting storage, acquiring raw images and extracting selected files from images. It opens its own window; a packaged build needs no browser or development server. The English interface follows [m7md-d’s brand system](BRAND-SYSTEM.md), with local fonts, measured statistics and original tool output. Users interpret the readings and choose operations.

## Version 0.4.6

The macOS menu bar panel uses SwiftUI/AppKit system controls and Swift Charts. Host sampling continues while the panel is closed; reopening preserves the rolling history and counter baseline. Genuine missing intervals, sleep and counter resets remain gaps. The CPU header includes live E/P active-residency frequencies and the mean of available CPU thermal-zone sensors, with original channels/sensors in More readings. These optional private macOS telemetry APIs were verified on M1; unavailable values stay unavailable.

Ports now use one connection tree shared by the Rust backend, main workspace and native panel. Explicit host connector numbers join USB paths and uniquely numbered Thunderbolt receptacles. Registry entry IDs and unique USB locations correlate device observations, with vendor/product and available serial checks. A connector appears once; original names, individual source readings and all original reports remain in Details. Names or model similarity never determine a hardware association.

While DRC is active, **Monitor → Quick Look** or **⌘⇧M** also opens the panel. Escape and clicking outside dismiss it. RAM uses binary GiB/MiB; storage uses decimal GB/MB. Hover or focus to see exact byte values.

The acquisition protections introduced in 0.4.3 remain: partial-map coverage, explicit read-request/error limits, manual SMART transport choices and destination/log failure handling. See [the researched cases and tested boundaries](docs/SSD-RESILIENCE.md). Published Debian packages remain available from the versioned release links below; the macOS monitor is a platform-specific surface.

- **Easy** workspace: observed device status, exact capacity, reported SMART/temperature, partition proportions, and explicit inspection / imaging / image exploration flows.
- **Professional** workspace: all original fields, vendor properties, unknown values, detailed settings, operation logs and raw output. The experience toggle preserves the same session and backend protections.
- **Offline command reference**: macOS and Linux with Debian, Ubuntu and Linux Mint installation profiles; categories, flag explanations, effect labels, search and copy-only examples. Destructive references require an explicit display toggle and are not executable app operations.
- Explicit forward/reverse acquisition direction and Linux host evidence even when no block device enumerates; secondary non-system SATA/NVMe sources are eligible after backing and mount checks.
- macOS diskutil / System Profiler and Linux lsblk / udev / sysfs discovery, identity checks, explicit SMART queries and connection watching.
- GNU ddrescue 1.30 acquisition with read-only source handles, persistent mapfiles, command review, stop/resume, recorded measurements and completion checks against the requested domain and image size.
- Bundled Sleuth Kit adapter for image partitions, supported filesystem metadata, directory browsing and selected-file extraction, including raw output preview and destination hashes.
- Local saved sessions and operation history, import/export, exact numeric strings and original command bytes.

Windows is a future platform adapter. Its reference is not presented as available. Filesystems are independent of the host: Windows disk formats such as NTFS, FAT and exFAT remain targets of the image reader. The existing generated-data validation covers FAT16, MBR, deleted/Unicode entries and fragmented binary extraction; NTFS and exFAT need further corpus validation.

The interface includes an adaptive Easy workspace, hover/focus explanations and readable decimal capacity values with exact bytes on hover or focus. **Port map** shows USB/hub/enclosure relationships, per-source power/statistics properties on macOS and canonical sysfs ancestry on Linux. USB interface observations enrich a device rather than appearing as extra Linux hardware. An enumerated enclosure and a declared current budget do not establish electrical power reaching its SSD or readable sectors. Original properties and command bytes remain available.

## Install Linux

Read [the full Debian-family installation guide](docs/LINUX-INSTALL.md). Published packages and checksums are available from [GitHub Releases](https://github.com/m7md-d/DRC/releases) after the tagged workflow succeeds. Successful manual/PR builds also expose packages as workflow artifacts. Builds run inside Debian 12 for amd64 and arm64.

## Build and run on macOS

Install Node.js, Rust and Xcode with its macOS SDK and Swift compiler, then install the native tools / Sleuth Kit headers with Homebrew:

```sh
brew install ddrescue smartmontools sleuthkit
npm ci
npm run desktop:build
```

Double-click `DRC.app` in the project root, or copy the complete application into Applications. The local bundle is ad-hoc signed, not notarized for public macOS distribution. `npm run desktop` opens a native development window. The SDK's shared libraries are packaged inside the final app; GNU ddrescue and smartctl remain separately installed macOS tools.

## Verify

```sh
npm run build
npm test
npm run native:test # macOS Swift counter / topology checks
npm run rust:test
npm run rust:check
```

[Linux installation/build instructions](docs/LINUX-INSTALL.md) include the Docker baseline and package dependencies. The build never receives a host disk. All data-read/copy/extraction tests use generated regular image files; no healthy personal flash or unavailable faulty SSD is used as a test source.

## Execution boundaries

DRC source handles are read only. The native backend executes fixed, reviewed commands without an interactive shell. SMART and sector reads never start automatically. Metadata-only protected media cannot be traversed, acquired or used as destinations. Physical acquisition excludes system media and mounted sources. macOS requires a positively external source; Linux admits resolved secondary hardware disks, including SATA/NVMe, after system/swap backing is excluded. macOS uses a per-operation Disk Arbitration mount veto; Linux retains an exclusive read-only block-device handle. Linux may request a per-device read-only descriptor from the system UDisks2 service through its standard desktop authorization flow. The app itself must not run as root. The broker and exclusive claim are not yet physically validated.

These controls do not establish a hardware or system-wide write blocker. Host reports do not measure live current consumption. Reported SMART status, a zero bad-sector count, a command's exit zero, or the image's full length alone does not establish a complete or correct recovery. Reconnect rebinding, crash-artifact adoption, flexible same-image ranges and hardware-blocked reads still need further work. Destructive repairs, formatting and source writes are reference-only examples, not implemented app adapters.

Raw command output is kept in the transcript; raw extraction stdout is stored in the destination file rather than duplicated in memory. The interface retains every queried original field and exact numeric value, including unrecognized fields. Querying installed tools and exposing implemented adapters are separate statuses.

## Implementation notes

Rust provides the backend, Tauri packages the app and React/TypeScript renders the main workspace. The macOS menu bar panel is a SwiftUI/AppKit surface statically linked into the same executable; it has no webview or separate helper application. Linux builds do not compile or link the macOS UI. Frontend code has no general shell or filesystem privileges. The build scripts use a local isolated Rust toolchain when present and otherwise use the standard toolchain.

- [SSD cases and resilience boundaries](docs/SSD-RESILIENCE.md)
- [Implementation and tested scope](docs/IMPLEMENTATION.md)
- [Product plan](docs/PROJECT_PLAN.ar.md)
- [Tool matrix](docs/TOOL_MATRIX.ar.md)
- [Source protection requirements](docs/SAFETY_MODEL.ar.md)
