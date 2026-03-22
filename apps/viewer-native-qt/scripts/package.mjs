import fs from "node:fs";
import path from "node:path";

import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-release", "macos-universal-release");
const { appRoot, cmakeBinary, cpackBinary, env } = resolveNativeQtToolchain();
const buildDir = path.join(appRoot, "build", preset);
const packageDir = path.join(appRoot, "dist", preset);
const buildType = preset.includes("debug") ? "Debug" : "Release";

function sanitizeQtDeployScript() {
  const qtDir = path.join(buildDir, ".qt");
  if (!fs.existsSync(qtDir)) {
    return;
  }

  for (const entry of fs.readdirSync(qtDir)) {
    if (!entry.startsWith("deploy_") || !entry.endsWith(".cmake")) {
      continue;
    }

    const scriptPath = path.join(qtDir, entry);
    const content = fs.readFileSync(scriptPath, "utf8");
    const patched = content
      .replace(/^include\((.+QtDeploySupport\.cmake)\)$/m, 'include("$1")')
      .replace(/^(\s*EXECUTABLE)\s+(.+\.exe)$/m, '$1 "$2"');

    if (patched !== content) {
      fs.writeFileSync(scriptPath, patched, "utf8");
    }
  }
}

spawnChecked(cmakeBinary, ["--preset", preset], { cwd: appRoot, env });
spawnChecked(cmakeBinary, ["--build", "--preset", preset], { cwd: appRoot, env });
sanitizeQtDeployScript();

fs.mkdirSync(packageDir, { recursive: true });
spawnChecked(cpackBinary, ["--config", path.join(buildDir, "CPackConfig.cmake"), "-C", buildType, "-B", packageDir], {
  cwd: buildDir,
  env
});
