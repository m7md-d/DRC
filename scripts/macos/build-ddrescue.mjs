import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export function buildMacDdrescue() {
  if (process.platform !== "darwin") return;
  const root = resolve(import.meta.dirname, "../..");
  const cache = join(root, ".cache");
  const archive = join(cache, "ddrescue-1.30.tar.lz");
  const expected =
    "2264622d309d6c87a1cfc19148292b8859a688e9bc02d4702f5cd4f288745542";
  mkdirSync(cache, { recursive: true });
  if (!existsSync(archive))
    execFileSync(
      "/usr/bin/curl",
      [
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--tlsv1.2",
        "https://ftp.gnu.org/gnu/ddrescue/ddrescue-1.30.tar.lz",
        "--output",
        archive,
      ],
      { stdio: "inherit" },
    );
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (digest !== expected)
    throw new Error("GNU ddrescue source checksum mismatch.");
  const patch = join(import.meta.dirname, "../ddrescue-readonly-fd.patch");
  const target =
    process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const binaries = join(root, "src-tauri/binaries");
  mkdirSync(binaries, { recursive: true });
  const output = join(binaries, `drc-ddrescue-${target}`);
  const stamp = `${output}.build-key`;
  const key = createHash("sha256")
    .update(digest)
    .update(readFileSync(patch))
    .update(readFileSync(new URL(import.meta.url)))
    .update(target)
    .digest("hex");
  const sources = join(cache, "ddrescue-macos-source");
  if (
    existsSync(output) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8") === key &&
    existsSync(join(sources, "ddrescue-1.30.tar.lz"))
  )
    return;
  const build = mkdtempSync(join(cache, "ddrescue-macos-build-"));
  execFileSync("/usr/bin/tar", ["-xf", archive, "-C", build]);
  const cwd = join(build, "ddrescue-1.30");
  execFileSync("/usr/bin/patch", ["--batch", "-p1", "-i", patch], {
    cwd,
    stdio: "inherit",
  });
  execFileSync(
    "./configure",
    [
      "CXX=/usr/bin/clang++",
      "CXXFLAGS=-O2 -Wall -Wextra -mmacosx-version-min=13.0",
    ],
    { cwd, stdio: "inherit" },
  );
  execFileSync("/usr/bin/make", ["-j2", "ddrescue"], { cwd, stdio: "inherit" });
  copyFileSync(join(cwd, "ddrescue"), output);
  const version = execFileSync(output, ["--version"], { encoding: "utf8" });
  if (!version.includes("DRC inherited-readonly-input v2"))
    throw new Error("The built copy tool lacks read-only descriptor support.");
  // Ship complete upstream source, the exact modification and build recipe.
  mkdirSync(sources, { recursive: true });
  copyFileSync(archive, join(sources, "ddrescue-1.30.tar.lz"));
  copyFileSync(patch, join(sources, "ddrescue-readonly-fd.patch"));
  copyFileSync(join(cwd, "COPYING"), join(sources, "COPYING"));
  writeFileSync(
    join(sources, "BUILD.txt"),
    "GNU ddrescue 1.30, GPL version 2 or later.\nDRC modification: 18 October 2026, inherited read-only input descriptors.\nSource SHA256: " +
      expected +
      "\n\nBuild on macOS with Command Line Tools:\ntar -xf ddrescue-1.30.tar.lz\ncd ddrescue-1.30\npatch -p1 < ../ddrescue-readonly-fd.patch\n./configure CXX=/usr/bin/clang++ 'CXXFLAGS=-O2 -Wall -Wextra -mmacosx-version-min=13.0'\nmake ddrescue\n",
  );
  writeFileSync(stamp, key);
}
