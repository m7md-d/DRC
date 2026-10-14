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
  if (process.platform !== "darwin") return;
  const root = resolve(import.meta.dirname, "../src-tauri");
  const include = "/opt/homebrew/include";
  if (!existsSync(`${include}/tsk/libtsk.h`)) return;
  const source = resolve(root, "src/image_helper.cpp");
  const target =
    process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const directory = resolve(root, "binaries");
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `drc-tsk-${target}`);
  const stamp = `${output}.build-key`;
  const key = createHash("sha256")
    .update(readFileSync(source))
    .update(readFileSync(`${include}/tsk/base/tsk_base.h`))
    .update(realpathSync("/opt/homebrew/lib/libtsk.23.dylib"))
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
      "/usr/bin/clang++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        `-I${include}`,
        source,
        "-L/opt/homebrew/lib",
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
