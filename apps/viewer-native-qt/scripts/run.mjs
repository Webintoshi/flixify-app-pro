import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const preset =
  process.env.FLIXIFY_NATIVE_QT_PRESET ||
  (process.platform === "win32" ? "windows-x64-debug" : "macos-universal-release");
const binaryDir = path.join(appRoot, "build", preset);

const candidates =
  process.platform === "win32"
    ? [path.join(binaryDir, "Flixify Native Qt.exe")]
    : process.platform === "darwin"
      ? [path.join(binaryDir, "Flixify Native Qt.app", "Contents", "MacOS", "Flixify Native Qt")]
      : [path.join(binaryDir, "Flixify Native Qt")];

let executablePath = null;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try next candidate.
  }
}

if (!executablePath) {
  throw new Error(`Native Qt binary not found under ${binaryDir}. Run configure/build first.`);
}

const result = spawnSync(executablePath, {
  cwd: appRoot,
  stdio: "inherit",
  shell: true
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
