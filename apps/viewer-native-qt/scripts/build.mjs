import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const { appRoot, cmakeBinary, env } = resolveNativeQtToolchain();

spawnChecked(cmakeBinary, ["--build", "--preset", preset], {
  cwd: appRoot,
  env
});
