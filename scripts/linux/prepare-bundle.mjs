import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export async function prepareLinuxBundle() {
  const root = resolve(import.meta.dirname, "../..");
  await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", ["scripts/linux/build-ddrescue.sh"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`GNU adapter build exited ${code}`)),
    );
  });
  const target =
    process.arch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
  const helper = resolve(root, `src-tauri/binaries/drc-tsk-${target}`);
  const report = execFileSync("/usr/bin/ldd", [helper], { encoding: "utf8" });
  if (report.includes("not found"))
    throw new Error(`Unresolved image adapter libraries: ${report}`);
  const folder = resolve(root, ".cache/linux-libs");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const files = [];
  const owners = new Set();
  const rpm = existsSync("/usr/bin/rpm");
  for (const line of report.split("\n")) {
    const match = line.match(/^\s*(\S+) => (\/\S+) /);
    if (!match) continue;
    const [, soname, path] = match;
    // Keep glibc and the host compiler ABI libraries supplied by the base OS.
    if (
      /^(libc|libm|libpthread|libdl|librt|libresolv|libstdc\+\+|libgcc_s)\.so/.test(
        soname,
      )
    )
      continue;
    const to = resolve(folder, soname);
    copyFileSync(path, to);
    // Resolve private transitive dependencies from the same bundle as libtsk.
    execFileSync("patchelf", ["--set-rpath", "$ORIGIN", to]);
    if (rpm) {
      const owner = execFileSync(
        "rpm",
        ["-qf", "--queryformat", "%{NAME}", realpathSync(path)],
        { encoding: "utf8" },
      ).trim();
      owners.add(owner);
    }
    files.push({
      soname,
      sha256: createHash("sha256").update(readFileSync(to)).digest("hex"),
    });
  }
  if (!files.some((file) => file.soname.startsWith("libtsk.")))
    throw new Error("The image adapter has no resolved Sleuth Kit library.");
  writeFileSync(
    resolve(folder, "manifest.json"),
    JSON.stringify({ target, files }, null, 2),
  );
  // Fedora ships license files as RPM metadata, unlike Debian's copyright files.
  for (const owner of owners) {
    const paths = execFileSync("rpm", ["-qL", owner], { encoding: "utf8" })
      .trim()
      .split("\n");
    for (const path of paths) {
      if (
        !path.startsWith("/usr/share/licenses/") ||
        !existsSync(path) ||
        !statSync(path).isFile()
      )
        continue;
      const to = resolve(
        folder,
        "licenses",
        path.slice("/usr/share/licenses/".length),
      );
      mkdirSync(dirname(to), { recursive: true });
      // Skip directory entries; preserve each package's license hierarchy.
      copyFileSync(path, to);
    }
  }
  // Retain the corresponding Debian copyright notices when building on Debian.
  execFileSync("bash", [
    "-c",
    'for p in /usr/share/doc/libtsk* /usr/share/doc/libafflib* /usr/share/doc/libewf* /usr/share/doc/libbfio* /usr/share/doc/libvhdi* /usr/share/doc/libvmdk* /usr/share/doc/libssl*; do if [ -f "$p/copyright" ]; then cp "$p/copyright" "$1/$(basename "$p").copyright"; fi; done',
    "--",
    folder,
  ]);
}
