import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const { appRoot, cmakeBinary, env } = resolveNativeQtToolchain(preset);

spawnChecked(cmakeBinary, ["--preset", preset], {
  cwd: appRoot,
  env
});
