#!/usr/bin/env bash
# Install a reviewed, locally downloaded RPM. No disk permissions are changed.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash install-fedora.sh /absolute/path/to/DRC-VERSION-RELEASE.ARCH.rpm\n' >&2; exit 2
fi
package=$(realpath -- "$1")
if [[ $(rpm -qp --queryformat '%{NAME}' "$package") != drc ]]; then
  printf 'This package is not named drc. Refusing installation.\n' >&2; exit 2
fi
architecture=$(rpm -qp --queryformat '%{ARCH}' "$package")
if [[ "$architecture" != "$(rpm --eval '%{_arch}')" ]]; then
  printf 'Package architecture %s does not match this system.\n' "$architecture" >&2; exit 2
fi
sudo dnf install "$package"
printf 'Installed. Launch DRC from the Applications menu, or run drc as your desktop user.\n'
