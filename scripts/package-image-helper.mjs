import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  realpath,
  readFile,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
const exec = promisify(execFile);

// Resolve the adapter's exact SDK dependency graph. No host library is modified.
export async function packageImageHelper(bundle) {
  if (process.platform !== "darwin") return;
  const helper = join(bundle, "Contents/MacOS/drc-tsk");
  if (!existsSync(helper))
    throw new Error("The packaged image reader is absent.");
  const frameworks = join(bundle, "Contents/Frameworks");
  const resources = join(bundle, "Contents/Resources/ImageReaderLibraries");
  await mkdir(frameworks, { recursive: true });
  await mkdir(resources, { recursive: true });
  const graph = new Map();
  const names = new Map();
  async function dependencies(file) {
    const { stdout } = await exec("/usr/bin/otool", ["-L", file]);
    return stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" (compatibility")[0])
      .filter(
        (path) =>
          path.startsWith("/opt/homebrew/") || path.startsWith("/usr/local/"),
      );
  }
  async function visit(original) {
    const resolved = await realpath(original);
    if (graph.has(resolved)) return;
    const name = basename(resolved);
    if (names.has(name) && names.get(name) !== resolved)
      throw new Error(`Conflicting packaged library names: ${name}`);
    names.set(name, resolved);
    const links = await dependencies(resolved);
    const destination = join(frameworks, name);
    graph.set(resolved, { destination, name, links, original });
    await copyFile(resolved, destination);
    for (const link of links)
      if ((await realpath(link)) !== resolved) await visit(link);
  }
  const top = await dependencies(helper);
  for (const link of top) await visit(link);
  for (const [resolved, library] of graph) {
    await exec("/usr/bin/install_name_tool", [
      "-id",
      `@rpath/${library.name}`,
      library.destination,
    ]);
    for (const link of library.links) {
      if ((await realpath(link)) === resolved) continue;
      const dependency = graph.get(await realpath(link));
      await exec("/usr/bin/install_name_tool", [
        "-change",
        link,
        `@loader_path/${dependency.name}`,
        library.destination,
      ]);
    }
    const cell = resolved.match(/^(.*\/Cellar\/[^/]+\/[^/]+)\//)?.[1];
    if (cell) {
      for (const file of [
        "COPYING",
        "LICENSE",
        "LICENSE.txt",
        "NOTICE",
        "AUTHORS",
      ]) {
        if (existsSync(join(cell, file)))
          await copyFile(
            join(cell, file),
            join(resources, `${library.name}-${file}`),
          );
      }
    }
  }
  for (const link of top) {
    const dependency = graph.get(await realpath(link));
    await exec("/usr/bin/install_name_tool", [
      "-change",
      link,
      `@executable_path/../Frameworks/${dependency.name}`,
      helper,
    ]);
  }
  const manifest = [];
  for (const library of graph.values())
    manifest.push({ name: library.name, original: library.original });
  await writeFile(
    join(resources, "libraries.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // Tauri signs after bundling; these exact local copies are subsequently sealed
  // again by the desktop script. Verify no Homebrew dependency remains reachable.
  for (const file of [
    helper,
    ...Array.from(graph.values(), (l) => l.destination),
  ]) {
    if ((await dependencies(file)).length)
      throw new Error(`An external SDK dependency remains in ${file}`);
  }
  for (const library of graph.values())
    await exec("/usr/bin/codesign", [
      "--force",
      "--sign",
      "-",
      library.destination,
    ]);
  await exec("/usr/bin/codesign", ["--force", "--sign", "-", helper]);
  await exec(helper, ["--version"]);
}
