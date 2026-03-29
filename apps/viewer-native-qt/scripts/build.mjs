import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const { appRoot, cmakeBinary, buildCmakeBinary, env } = resolveNativeQtToolchain(preset);
const androidPreset = preset.startsWith("android");

spawnChecked(androidPreset ? buildCmakeBinary : cmakeBinary, ["--build", "--preset", preset], {
  cwd: appRoot,
  env
});
