import { spawn } from "node:child_process";
import { buildEnvironment } from "./environment.mjs";
import { buildImageHelper } from "./image-helper.mjs";

await buildImageHelper();

const child = spawn("cargo", process.argv.slice(2), {
  stdio: "inherit",
  env: buildEnvironment(),
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
