import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveAndroidConfigureArgs, resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-debug", "macos-universal-release");
const toolchain = resolveNativeQtToolchain(preset);
const { appRoot, cmakeBinary, ninjaBinary, env } = toolchain;
const androidPreset = preset.startsWith("android");

function removeBuildDir(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  try {
    fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
  }

  if (fs.existsSync(targetDir) && process.platform === "win32") {
    spawnSync("cmd.exe", ["/d", "/s", "/c", `if exist "${targetDir}" rmdir /s /q "${targetDir}"`], {
      stdio: "ignore"
    });
  }
}

if (androidPreset) {
  const buildDir = path.join(appRoot, "build", preset);
  const buildType = preset.includes("debug") ? "Debug" : "Release";
  removeBuildDir(buildDir);
  const args = [
    "-S", appRoot,
    "-B", buildDir,
    "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=" + buildType,
    "-DCMAKE_MAKE_PROGRAM=" + ninjaBinary,
    ...resolveAndroidConfigureArgs(toolchain, preset)
  ];

  if (preset.includes("android-tv")) {
    args.push("-DFLIXIFY_ANDROID_TV=ON");
  }

  spawnChecked(cmakeBinary, args, {
    cwd: appRoot,
    env
  });
} else {
  spawnChecked(cmakeBinary, ["--preset", preset], {
    cwd: appRoot,
    env
  });
}
