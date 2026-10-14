#!/usr/bin/env bash
# Install a reviewed, locally downloaded package. Does not read or modify disks.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash install-debian.sh /absolute/path/to/DRC_VERSION_ARCH.deb\n' >&2; exit 2
fi
package=$(realpath -- "$1")
if [[ $(dpkg-deb --field "$package" Package) != drc ]]; then
  printf 'This package is not named drc. Refusing installation.\n' >&2; exit 2
fi
architecture=$(dpkg-deb --field "$package" Architecture)
if [[ "$architecture" != "$(dpkg --print-architecture)" ]]; then
  printf 'Package architecture %s does not match this system.\n' "$architecture" >&2; exit 2
fi
sudo apt update
sudo apt install "$package"
printf 'Installed. Launch DRC from the Applications menu, or run drc as your desktop user.\n'
