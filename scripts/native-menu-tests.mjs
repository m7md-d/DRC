import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  console.log("Native Swift menu tests run on macOS only.");
  process.exit(0);
}
const cache = resolve(".cache/native-menu-tests");
mkdirSync(cache, { recursive: true });
const binary = resolve(cache, "models-tests");
const result = spawnSync(
  "xcrun",
  [
    "swiftc",
    "-swift-version",
    "5",
    "-warnings-as-errors",
    "-module-cache-path",
    resolve(cache, "modules"),
    "src-tauri/native/MenuModels.swift",
    "src-tauri/native/tests/MenuModelsTests.swift",
    "-o",
    binary,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const tests = spawnSync(binary, [], { stdio: "inherit" });
if (tests.status !== 0) process.exit(tests.status ?? 1);
const stateBinary = resolve(cache, "state-tests");
const stateBuild = spawnSync(
  "xcrun",
  [
    "swiftc",
    "-swift-version",
    "5",
    "-warnings-as-errors",
    "-module-cache-path",
    resolve(cache, "modules"),
    "src-tauri/native/MenuModels.swift",
    "src-tauri/native/MenuBar.swift",
    "src-tauri/native/tests/MenuStateTests.swift",
    "-o",
    stateBinary,
  ],
  { stdio: "inherit" },
);
if (stateBuild.status !== 0) process.exit(stateBuild.status ?? 1);
const stateTests = spawnSync(stateBinary, [], { stdio: "inherit" });
process.exit(stateTests.status ?? 1);
