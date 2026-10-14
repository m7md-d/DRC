import { existsSync, readdirSync } from "node:fs";
import { resolve, delimiter } from "node:path";

export function buildEnvironment() {
  const root = resolve(import.meta.dirname, "..");
  const isolated = resolve(root, ".tools/rustup");
  const env = { ...process.env };
  // Keep the owner's external-drive Rust installation untouched.
  if (existsSync(resolve(isolated, "toolchains"))) {
    const toolchain = readdirSync(resolve(isolated, "toolchains")).find(
      (name) => name.startsWith("stable-"),
    );
    if (toolchain) {
      env.RUSTUP_HOME = isolated;
      env.CARGO_HOME = resolve(root, ".tools/cargo");
      env.PATH =
        resolve(isolated, "toolchains", toolchain, "bin") +
        delimiter +
        env.PATH;
    }
  }
  return env;
}
