import { spawn } from "node:child_process";
import { buildEnvironment } from "./environment.mjs";
import { buildImageHelper } from "./image-helper.mjs";

await buildImageHelper();

const args = process.argv.slice(2);
if (process.platform === "darwin" && ["test", "check", "clippy", "build", "run"].includes(args[0])) {
  const separator = args.indexOf("--");
  args.splice(separator < 0 ? args.length : separator, 0, "--features", "macos-menu-bar");
}
const child = spawn("cargo", args, {
  stdio: "inherit",
  env: buildEnvironment(),
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
