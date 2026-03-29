import { access } from "node:fs/promises";
import path from "node:path";

import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const { appRoot, env } = resolveNativeQtToolchain(preset);
const binaryDir = path.join(appRoot, "build", preset);

const candidates =
  process.platform === "win32"
    ? [path.join(binaryDir, "Flixify Pro.exe")]
    : process.platform === "darwin"
      ? [path.join(binaryDir, "Flixify Pro.app", "Contents", "MacOS", "Flixify Pro")]
      : [path.join(binaryDir, "Flixify Pro")];

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

spawnChecked(executablePath, [], {
  cwd: appRoot,
  env
});
