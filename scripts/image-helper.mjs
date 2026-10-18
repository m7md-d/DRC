import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export async function buildImageHelper() {
  if (!["darwin", "linux"].includes(process.platform)) throw new Error("Image adapter builds currently support macOS and Linux.");
  const linux = process.platform === "linux";
  if (linux) await new Promise((done, reject) => { const child = spawn("bash", [resolve(import.meta.dirname, "linux/build-ddrescue.sh")], { stdio: "inherit" }); child.on("error", reject); child.on("exit", code => code === 0 ? done() : reject(new Error(`GNU adapter build exited ${code}`))); });
  const root = resolve(import.meta.dirname, "../src-tauri");
  const include = linux ? "/usr/include" : "/opt/homebrew/include";
  if (!existsSync(`${include}/tsk/libtsk.h`)) throw new Error("Missing Sleuth Kit development headers. Debian family: sudo apt install libtsk-dev. Fedora: sudo dnf install sleuthkit-devel");
  const source = resolve(root, "src/image_helper.cpp");
  const target =
    linux ? (process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu") : (process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin");
  const directory = resolve(root, "binaries");
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `drc-tsk-${target}`);
  const stamp = `${output}.build-key`;
  const key = createHash("sha256")
    .update(readFileSync(source))
    .update(readFileSync(resolve(root, "src/mac_recovery_helper.hpp")))
    .update(readFileSync(`${include}/tsk/base/tsk_base.h`))
    .update(linux ? readFileSync(`${include}/tsk/libtsk.h`) : realpathSync("/opt/homebrew/lib/libtsk.23.dylib"))
    .update(target)
    .digest("hex");
  if (
    existsSync(output) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8") === key
  )
    return;
  await new Promise((resolve, reject) => {
    const child = spawn(
      linux ? "/usr/bin/g++" : "/usr/bin/clang++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        `-I${include}`,
        source,
        ...(linux ? ["-Wl,-rpath,$ORIGIN/../lib/drc"] : ["-L/opt/homebrew/lib"]),
        ...(linux ? [] : ["-framework", "IOKit", "-framework", "CoreFoundation"]),
        "-ltsk",
        "-o",
        output,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Image adapter build exited ${code}`)),
    );
  });
  writeFileSync(stamp, key);
}
