<div align="center">
  <img src="docs/assets/app-icon.png" width="112" height="112" alt="DRC app icon" />
  <h1>DRC</h1>
  <p><strong>Disk Resource Console</strong></p>
  <p>Disk inspection, raw imaging and file recovery.</p>
  <p><strong>Source v{{version}}</strong> · macOS · Linux</p>
  <p>
    <a href="https://github.com/m7md-d/DRC/releases/latest"><img src="https://img.shields.io/github/v/release/m7md-d/DRC?label=Release&amp;style=flat-square&amp;labelColor=171D23&amp;color=2D9BEF" alt="Latest published release" /></a>
    <a href="https://github.com/m7md-d/DRC/actions/workflows/linux.yml"><img src="https://github.com/m7md-d/DRC/actions/workflows/linux.yml/badge.svg" alt="Desktop package build status" /></a>
  </p>
  <p>
    <img src="docs/assets/stack.svg" width="588" height="32" alt="Built with Rust, Tauri, React, TypeScript and SwiftUI" />
  </p>
  <p>
    <a href="https://github.com/m7md-d/DRC/releases/latest">Downloads</a> ·
    <a href="docs/RELEASE-NOTES.md">Release notes</a> ·
    <a href="docs/LINUX-INSTALL.md">Linux installation</a>
  </p>
</div>

## Functions

- Connected disks, partitions, SMART/NVMe readings and original command output.
- USB, hub and enclosure tree, network interfaces and reported display-link states.
- Raw imaging with GNU ddrescue: mapfiles, stop/resume, rate charts and read-error counts.
- Image browsing and selected-file extraction through Sleuth Kit.
- Local sessions and a command reference for macOS, Debian-family Linux and Fedora.
- Native macOS menu bar panel for CPU, memory, disks and ports.

Easy uses copy steps, a file browser and connection cards. Professional exposes complete tables and parameters. Changing mode preserves the current task, entered values and selections. Both modes retain original readings and source protections.

{{screenshots}}
## Install

**Linux:** download the `.deb` or `.rpm` for your architecture and verify `SHA256SUMS`. See [installation commands](docs/LINUX-INSTALL.md). Run the application as a normal desktop user.

**macOS:** build locally with Node.js, Rust, Xcode command-line tools and Homebrew:

```sh
brew install ddrescue smartmontools sleuthkit
npm ci
npm run desktop:build
```

Open `DRC.app` in the project root. The local bundle is ad-hoc signed; it is not notarized. The image reader is bundled. GNU ddrescue and smartctl must be installed separately on macOS.

## Source access

DRC opens sources read-only. Imaging and extraction write to a reviewed destination. Mounted and system disks are excluded from physical acquisition. DRC does not provide system-wide or hardware write blocking.

USB power budgets are reported metadata, not measured electrical consumption. A device without readable storage access cannot be imaged. NTFS/exFAT reader support depends on Sleuth Kit; the generated recovery test corpus currently covers FAT16/MBR.

Windows is not implemented. Details: [source protection](docs/SAFETY_MODEL.ar.md), [tested scope](docs/BUILD_CHECKS.md), [SSD failure handling](docs/SSD-RESILIENCE.md).

## Development

Rust backend, Tauri desktop shell, React/TypeScript workspace and SwiftUI/AppKit macOS monitor.

```sh
npm test
npm run native:test
npm run rust:test
npm run rust:check
npm run desktop
```

[Release and screenshot scripts](docs/RELEASING.md) · [Writing rules](docs/COPY-STYLE.md) · [Brand](BRAND-SYSTEM.md)
