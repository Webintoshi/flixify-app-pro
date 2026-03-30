import path from "node:path";

import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const { appRoot, cmakeBinary, buildCmakeBinary, env } = resolveNativeQtToolchain(preset);
const androidPreset = preset.startsWith("android");

if (androidPreset) {
  spawnChecked(buildCmakeBinary, ["--build", path.join(appRoot, "build", preset), "--parallel"], {
    cwd: appRoot,
    env
  });
} else {
  spawnChecked(cmakeBinary, ["--build", "--preset", preset], {
    cwd: appRoot,
    env
  });
}
