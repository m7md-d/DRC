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
const result = spawnSync("xcrun", ["swiftc", "-swift-version", "5", "-warnings-as-errors", "-module-cache-path", resolve(cache, "modules"), "src-tauri/native/MenuModels.swift", "src-tauri/native/tests/MenuModelsTests.swift", "-o", binary], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const tests = spawnSync(binary, [], { stdio: "inherit" });
process.exit(tests.status ?? 1);
