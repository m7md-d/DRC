import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { buildEnvironment } from "./environment.mjs";
import { packageImageHelper } from "./package-image-helper.mjs";
import { prepareLinuxBundle } from "./linux/prepare-bundle.mjs";
import { buildImageHelper } from "./image-helper.mjs";

await buildImageHelper();
if (process.platform === "linux" && process.argv[2] === "build") await prepareLinuxBundle();

const cli = resolve(
  import.meta.dirname,
  "../node_modules/@tauri-apps/cli/tauri.js",
);
const env = buildEnvironment();
// The isolated Darwin toolchain's rust-objcopy has a broken LLVM runtime path.
// Keep symbols instead of silently relying on a failed strip operation.
if (process.platform === "darwin") env.CARGO_PROFILE_RELEASE_STRIP = "none";
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
child.on("exit", async (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const bundle = resolve(
    import.meta.dirname,
    "../src-tauri/target/release/bundle/macos/DRC.app",
  );
  if (
    process.platform !== "darwin" ||
    process.argv[2] !== "build" ||
    !existsSync(bundle)
  )
    process.exit(0);
  try {
    await packageImageHelper(bundle);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  // Seal the complete local bundle after packaging; this is ad-hoc, not distribution signing.
  const sign = spawn(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", bundle],
    { stdio: "inherit" },
  );
  sign.on("exit", (code) => {
    if (code !== 0) process.exit(code ?? 1);
    const verify = spawn(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", bundle],
      { stdio: "inherit" },
    );
    verify.on("exit", (code) => {
      if (code !== 0) process.exit(code ?? 1);
      const deliverable = resolve(import.meta.dirname, "../DRC.app");
      const copy = spawn("/usr/bin/ditto", [bundle, deliverable], {
        stdio: "inherit",
      });
      copy.on("exit", (code) => {
        if (code === 0) console.log(`Standalone application: ${deliverable}`);
        process.exit(code ?? 1);
      });
      copy.on("error", (error) => {
        console.error(error.message);
        process.exit(1);
      });
    });
    verify.on("error", (error) => {
      console.error(error.message);
      process.exit(1);
    });
  });
  sign.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
