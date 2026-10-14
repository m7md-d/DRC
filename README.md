# DRC — Disk Recovery Control

A standalone desktop workspace for storage inspection. DRC exposes complete device information and original tool output; the user chooses the queries and interprets the readings.

The interface is English only and follows [m7md-d's brand system](BRAND-SYSTEM.md). It uses local fonts and assets, a neutral dark palette, and storage terminology without simulated readings or automated diagnoses.

## Current build: 0.1.0

Implemented on macOS / Apple Silicon:

- Physical-device discovery and the complete diskutil property lists.
- Partition entries, exact capacities and unrecognized/vendor fields.
- Disk Arbitration activity via diskutil activity, with optional connection watching.
- Explicit SMART / NVMe information requests using smartctl -a -j when installed.
- Full host USB and Thunderbolt reports on request.
- Integrated xterm output pane with command history, stdout, stderr, exit status and timing.
- Complete session JSON copied to the clipboard, including original command bytes as base64.
- Read-only metadata command allowlist. No arbitrary executable paths or shell input.

Acquisition, filesystem extraction, repair, formatting and raw writes are **not implemented yet**. Installed executables and implemented adapters are listed separately in the Tools tab.

The first host is macOS, not the first target filesystem. NTFS, FAT and exFAT are core targets for the filesystem-reader phase. Raw acquisition and filesystem readers have separate contracts from platform/device access; encrypted and unknown media do not require mounting for future raw acquisition.

## Run as a desktop application

The deliverable is a macOS .app that opens its own window. It requires no browser or running development server after packaging.

```sh
npm ci
npm run desktop
```

Build the standalone application:

```sh
npm run desktop:build
open DRC.app
```

The build also copies the standalone application to DRC.app in the project root. Double-click it in Finder, or copy the complete application to Applications. Distribution signing and notarization are a later release step; this is a local development build.

## Verify

```sh
npm run build
npm test
npm run rust:test
npm run rust:check
```

Rust is the native backend, Tauri packages the desktop app, and React/TypeScript renders its embedded interface. Tauri uses the system WebView inside its own native window. Frontend code has no shell or filesystem plugin privileges.

## Execution boundaries

- DRC exposes metadata commands only. SMART never starts automatically and no self-test is requested.
- No mounting, unmounting, source filesystem repair, controller setting changes or raw sector scans.
- DRC's command policy does not block macOS or other applications from writing. OS WritableMedia is displayed separately. Hardware write-blocker state is not verified.
- The personal flash drive is reserved for discovery and information only. It is not an acquisition, benchmark or write-test target.
- SMART availability depends on permissions, transport, bridge and device support. Nonzero smartctl exit flags do not discard reported fields.
- A session token and fresh reported descriptor are checked before SMART. This is not a claim of globally unique hardware identity.
- Data is held in memory for this session; use Copy session JSON before closing. No automatic disk persistence is claimed.
- Connection reports are host-wide. DRC does not invent an association with the selected disk or a current-draw measurement.

## Development environment

The owner's existing Rust setup points to an unavailable external volume. An isolated toolchain was created in .tools/ without changing that setup. The scripts use it when present and otherwise use the normal system toolchain. Toolchains, caches, build outputs and local verification artifacts are ignored.

## Design and implementation notes

- [Implementation details and tested scope](docs/IMPLEMENTATION.md)
- [Product plan](docs/PROJECT_PLAN.ar.md)
- [Tool matrix](docs/TOOL_MATRIX.ar.md)
- [Source protection requirements](docs/SAFETY_MODEL.ar.md)

The planning documents are Arabic reference material; the application is entirely English.
