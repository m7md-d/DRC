#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
archive=.cache/ddrescue-1.30.tar.lz
expected=2264622d309d6c87a1cfc19148292b8859a688e9bc02d4702f5cd4f288745542
mkdir -p .cache src-tauri/binaries
if [[ ! -f "$archive" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 https://ftp.gnu.org/gnu/ddrescue/ddrescue-1.30.tar.lz --output "$archive"
fi
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
source_dir=.cache/ddrescue-1.30
patch_file=scripts/ddrescue-readonly-fd.patch
patch_digest=$(sha256sum "$patch_file" | cut -d ' ' -f1)
if [[ ! -f "$source_dir/.drc-fd-patch-sha256" ]] || [[ $(cat "$source_dir/.drc-fd-patch-sha256") != "$patch_digest" ]]; then
  rm -rf "$source_dir"
  tar --lzip -xf "$archive" -C .cache
  patch --batch -d "$source_dir" -p1 < "$patch_file"
  printf '%s\n' "$patch_digest" > "$source_dir/.drc-fd-patch-sha256"
fi
machine=$(uname -m)
case "$machine" in x86_64) target=x86_64-unknown-linux-gnu;; aarch64|arm64) target=aarch64-unknown-linux-gnu;; *) printf 'Unsupported architecture: %s\n' "$machine" >&2; exit 1;; esac
(
  cd "$source_dir"
  ./configure CXXFLAGS='-O2 -Wall -Wextra'
  make -j2
)
install -m 755 "$source_dir/ddrescue" "src-tauri/binaries/drc-ddrescue-$target"
"src-tauri/binaries/drc-ddrescue-$target" --version
