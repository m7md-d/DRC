# DRC on Debian-family Linux

DRC opens its own desktop window. The packaged application needs neither a browser nor a development server. The initial Linux packages target **Debian 12 or newer, amd64 and arm64**. Other distributions are not validated yet. Ubuntu / Linux Mint are Debian-family reference profiles in the app; a profile is not a claim that a package was tested on that distribution.

## Download and install

1. Open [DRC Releases](https://github.com/m7md-d/DRC/releases). Select a published version and download its `.deb` for your architecture, `SHA256SUMS`, and optionally `install-debian.sh`. If no release exists, use the workflow artifacts or build from source below; a prepared workflow does not create a release until it runs successfully.
2. Check your architecture:

   ```sh
   dpkg --print-architecture
   ```

   Choose `amd64` for x86-64 PCs, or `arm64` for 64-bit ARM Linux. A macOS `.app` does not run on Linux.
3. In the download folder, verify the exact downloaded package against its entry in `SHA256SUMS`. The file lists both architectures; checking your one downloaded file avoids a missing-file error for the other architecture:

   ```sh
   sha256sum DRC_0.4.1_arm64.deb
   ```

   Compare the printed checksum with the matching filename in `SHA256SUMS`. Package filenames use the actual version/architecture from the release. Checksums detect an altered download; obtain them from the same reviewed official release.
4. Install your actual downloaded filename:

   ```sh
   sudo apt update
   sudo apt install ./DRC_0.4.1_arm64.deb
   ```

   Alternatively, inspect the provided script, then run `bash install-debian.sh ./DRC_0.4.1_arm64.deb`. It checks the package name and architecture and uses APT for dependencies. It does not modify device permissions or read/write connected media.
5. Launch **DRC** from your desktop's Applications menu, or run `drc` in a terminal **as your ordinary desktop user**. Never start DRC with `sudo`.

The package includes its private image-reader libraries and **GNU ddrescue 1.30** as `drc-ddrescue`. APT resolves WebKitGTK/GTK and installs SMART, USB, udev and standalone Sleuth Kit tools. Dependencies require network access on first installation. DRC itself does not contact a server to inspect or copy data. This is a desktop package, not a headless server utility.

## What the Linux backend supports

- Physical block-device enumeration using explicit `lsblk --json --bytes` columns, full returned fields and exact numeric strings.
- Visual USB/hub/enclosure hierarchy from canonical sysfs parents, node properties and explicit snapshot ancestry. Power budgets remain declared metadata; actual SSD current/voltage is not measured.
- On-request PCIe/NVMe-controller evidence and raw kernel messages even when no block device appears. No reset or firmware update is triggered.
- Complete `udevadm` properties, sysfs device binding and block-event watching.
- On-request `smartctl -a -j`, USB topology and declared sysfs connection properties. No live electrical-current measurement or automatic diagnosis.
- Regular-image acquisition with the same resumable mapfile engine, stop/review/resume controls, saved sessions and charts.
- Bundled Sleuth Kit image browsing and selected-file extraction, independent of the host filesystem. Reader format support depends on the bundled SDK; encrypted content requires separate decryption.
- Physical acquisition **only** when a device is a resolved hardware-backed disk, unmounted and not system/swap backing, and a **read-only and exclusive** source handle can be obtained. The native backend keeps that exclusive block-device handle through the operation. It never unmounts the source or runs the application as root. If ordinary-user access is denied, it requests a narrowly scoped read-only descriptor from the system UDisks2 service; the desktop authorization agent may ask for administrator authentication.

A normal Debian desktop often denies direct raw-device access. DRC can request UDisks2 OpenDevice in read-only mode with exclusive flags. It validates the returned descriptor's mode and block-device identity before use. This needs an active system D-Bus, UDisks2 and your desktop's existing polkit authentication agent; refusal or an unavailable service stops preparation. Physical authorization and kernel exclusion still need testing on a dedicated sacrificial device. Do not bypass it by running the entire application as root or granting the user unrestricted access to all disks. Protected metadata-only media remain excluded from extended reads and all destinations.

Path backing is resolved through `/sys/dev/block` and the partition/slave graph. Local LVM/RAID backing is admitted only if every hardware store is resolved in the live inventory. Loop, network, overlay/container, unknown and non-block-backed filesystems are refused as acquisition/extraction sources or destinations. Resolved secondary SATA / NVMe disks are permitted even when their physical location is not reported; system disks remain excluded as physical sources; ordinary image files on a resolved local system volume are allowed.

DRC's read-only source handle and exclusive claim are not a hardware or system-wide write blocker. The OS can act on a disk before DRC acquires its handle; already mounted media must be prepared separately. A source that reports no readable sectors cannot be rescued by software alone. A full-length output file is not proof of a complete map or correct original capacity.

## Standalone tool installation and reference

The app's **Reference** opens an offline cheat sheet. Select **Linux**, then **Debian**, **Ubuntu**, or **Linux Mint**. Commands are grouped by installation, device identification, inspection, imaging, map review and filesystem exploration. Search includes flags. Destructive examples are hidden until explicitly enabled. Examples are copied only; they are never executed by the app.

For independent terminal use:

```sh
sudo apt update
sudo apt install gddrescue smartmontools sleuthkit testdisk usbutils udev
```

The distribution's `ddrescue` may be older than 1.30. DRC uses its packaged `drc-ddrescue` for acquisition; `--no-sweep` requires 1.30. The included ddrescue source archive, COPYING notice and reproducible build script accompany the binary. Do not replace or mix a rescue mapfile with an unrelated image.

## Build from source on Debian 12+

Install development dependencies:

```sh
sudo apt update
sudo apt install udisks2 pciutils build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev patchelf libtsk-dev sleuthkit gddrescue smartmontools usbutils udev lzip curl ca-certificates python3 git
```

Install **Node.js 22** and a current **stable Rust** toolchain using their official distributions. Confirm `node --version`, `npm --version`, `rustc --version` and `cargo --version`. Then:

```sh
git clone https://github.com/m7md-d/DRC.git
cd DRC
npm ci
npm test
npm run rust:test
npm run rust:check
npm run desktop:build:linux
```

The build downloads GNU ddrescue 1.30 from GNU over HTTPS and verifies a pinned SHA-256 before compilation. It compiles the image adapter against local Sleuth Kit headers and packages matching private libraries. Find the installer under `src-tauri/target/release/bundle/deb/`. Install the actual generated `.deb` with APT as above.

For a reproducible Debian 12 baseline using Docker:

```sh
docker build --file scripts/linux/Dockerfile --target artifacts --output type=local,dest=linux-packages .
```

This builds for the host container architecture. It runs frontend tests, Rust tests and strict checks before packaging. The output directory contains the `.deb`, installation script, this guide and `SHA256SUMS`. Docker builds use only repository files and generated test images; no host device is passed to the container.

## GitHub builds

The **Debian desktop packages** workflow supports pull requests, a manual run and version tags. Each successful run uploads amd64 and arm64 package artifacts. A version tag such as `v0.4.1` publishes a release **only after both builds pass**. The repository must allow Actions and its token to create releases. Review the version in `package.json`, `Cargo.toml` and Tauri configuration before tagging.

## Updating, removal and startup errors

Install a new reviewed package with `sudo apt install ./NEW_PACKAGE.deb`; local saved sessions remain in the application's user data directory. Remove the application with `sudo apt remove drc`. APT removal does not deliberately delete your recovery images or session data.

If dependency resolution fails, confirm that your Debian-family release provides WebKitGTK 4.1 and that package indexes are current. If the app cannot start, run `drc` from your normal terminal and preserve the exact error. A missing display requires a desktop session. A raw-device permission denial is an access restriction, not a diagnosis of disk failure. Do not change source permissions or filesystem contents in response to it.

Build/dependency references: [Tauri Debian packaging](https://v2.tauri.app/distribute/debian/), [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Debian lsblk manual](https://manpages.debian.org/bookworm/util-linux/lsblk.8.en.html), [GNU ddrescue](https://www.gnu.org/software/ddrescue/manual/ddrescue_manual.html).
