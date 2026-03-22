import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const presetArgIndex = process.argv.findIndex((value) => value === "--preset");
const preset =
  presetArgIndex >= 0
    ? process.argv[presetArgIndex + 1]
    : process.env.FLIXIFY_NATIVE_QT_PRESET ||
      (process.platform === "win32" ? "windows-x64-debug" : "macos-universal-release");

const result = spawnSync("cmake", ["--build", "--preset", preset], {
  cwd: appRoot,
  stdio: "inherit",
  shell: true
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
