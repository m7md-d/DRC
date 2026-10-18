<div align="center">
  <img src="docs/assets/app-icon.png" width="112" height="112" alt="DRC app icon" />
  <h1>DRC</h1>
  <p><strong>Disk Resource Console</strong></p>
  <p>Disk inspection, raw imaging and file recovery.</p>
  <p>
    <a href="package.json"><img src="https://img.shields.io/static/v1?label=Source&amp;message=v0.5.2&amp;color=blue&amp;style=flat" alt="Source v0.5.2" /></a>
    <a href="#install"><img src="https://img.shields.io/static/v1?label=macOS&amp;message=13%2B&amp;color=000000&amp;style=flat&amp;logo=apple&amp;logoColor=white" alt="macOS 13+" /></a>
    <a href="docs/LINUX-INSTALL.md"><img src="https://img.shields.io/static/v1?label=Linux&amp;message=Debian+%2F+Fedora&amp;color=FCC624&amp;style=flat&amp;logo=linux&amp;logoColor=black" alt="Linux Debian / Fedora" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/static/v1?label=License&amp;message=GPL+v3&amp;color=blue&amp;style=flat" alt="License GPL v3" /></a>
  </p>
  <p>
    <a href="src-tauri/Cargo.toml"><img src="https://img.shields.io/static/v1?label=Rust&amp;message=edition+2021&amp;color=000000&amp;style=flat&amp;logo=rust&amp;logoColor=white" alt="Rust edition 2021" /></a>
    <a href="src-tauri/Cargo.lock"><img src="https://img.shields.io/static/v1?label=Tauri&amp;message=2.12.3&amp;color=FFC131&amp;style=flat&amp;logo=tauri&amp;logoColor=black" alt="Tauri 2.12.3" /></a>
    <a href="package-lock.json"><img src="https://img.shields.io/static/v1?label=React&amp;message=19.3.0&amp;color=61DAFB&amp;style=flat&amp;logo=react&amp;logoColor=black" alt="React 19.3.0" /></a>
    <a href="package-lock.json"><img src="https://img.shields.io/static/v1?label=TypeScript&amp;message=7.0.2&amp;color=3178C6&amp;style=flat&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 7.0.2" /></a>
    <a href="src-tauri/build.rs"><img src="https://img.shields.io/static/v1?label=SwiftUI&amp;message=Swift+5+mode&amp;color=F05138&amp;style=flat&amp;logo=swift&amp;logoColor=white" alt="SwiftUI Swift 5 mode" /></a>
  </p>
  <p>
    <a href="https://github.com/m7md-d/DRC/releases/latest">Downloads</a> ·
    <a href="docs/RELEASE-NOTES.md">Release notes</a> ·
    <a href="docs/LINUX-INSTALL.md">Linux installation</a> ·
    <a href="LICENSE">GPL v3</a>
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

## Screenshots

### Disk overview

![Device capacity, connection readings and inspection or imaging controls.](docs/images/overview.png)

Device capacity, connection readings and inspection or imaging controls.

### Image files

![Allocated and deleted entries read from a generated FAT16 image through the normal image reader.](docs/images/image-files.png)

Allocated and deleted entries read from a generated FAT16 image through the normal image reader.

### Command reference

![Linux installation commands, tool flags and copyable examples.](docs/images/command-reference.png)

Linux installation commands, tool flags and copyable examples.


## Install

**Linux:** download the `.deb` or `.rpm` for your architecture and verify `SHA256SUMS`. See [installation commands](docs/LINUX-INSTALL.md). Run the application as a normal desktop user.

**macOS:** build locally with Node.js, Rust, Xcode command-line tools and Homebrew:

```sh
brew install smartmontools sleuthkit
npm ci
npm run desktop:build
```

Open `DRC.app` in the project root. The local bundle is ad-hoc signed; it is not notarized. The image reader and GNU ddrescue are bundled. SMART queries use the separately installed smartmontools.

## Source access

DRC opens sources read-only. Imaging and extraction write to a reviewed destination. Mounted and system disks are excluded from physical acquisition. DRC does not provide system-wide or hardware write blocking.

On macOS, opening a raw source can request administrator authorization and require Full Disk Access. The app and copy process stay unprivileged; the authorized helper opens only the reviewed source for reading. Rebuilding an ad-hoc signed app can require renewing its privacy permission.

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

[Release and screenshot scripts](docs/RELEASING.md) · [Writing rules](docs/COPY-STYLE.md) · [Interface design](docs/DESIGN.md)
