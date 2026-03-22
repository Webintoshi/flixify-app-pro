import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function existingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveAppRoot() {
  return path.resolve(__dirname, "..");
}

export function resolvePreset(defaultWin = "windows-x64-debug", defaultOther = "macos-universal-release") {
  const presetArgIndex = process.argv.findIndex((value) => value === "--preset");
  if (presetArgIndex >= 0 && process.argv[presetArgIndex + 1]) {
    return process.argv[presetArgIndex + 1];
  }

  return process.env.FLIXIFY_NATIVE_QT_PRESET || (process.platform === "win32" ? defaultWin : defaultOther);
}

function resolveCmakeTool(executableName) {
  return existingPath([
    process.env[executableName.toUpperCase().replace(".", "_")],
    path.join(process.env.APPDATA ?? "", "Python", "Python314", "Scripts", executableName)
  ]);
}

function resolveQtRoot() {
  return (
    process.env.QT_ROOT ||
    existingPath([
      "C:\\Qt\\6.8.2\\msvc2022_64",
      "C:\\Qt\\6.8.2\\mingw_64"
    ])
  );
}

function resolveLibVlcRoot() {
  return (
    process.env.LIBVLC_ROOT ||
    existingPath([
      "C:\\Program Files\\VideoLAN\\VLC",
      "C:\\Program Files (x86)\\VideoLAN\\VLC"
    ])
  );
}

function resolveVcVars() {
  return existingPath([
    process.env.VCVARS64_BAT,
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat"
  ]);
}

function resolveNsisRoot() {
  return existingPath([
    process.env.NSIS_ROOT,
    "C:\\Program Files (x86)\\NSIS",
    "C:\\Program Files\\NSIS"
  ]);
}

function resolveMsvcEnvironment(baseEnv) {
  if (process.platform !== "win32") {
    return { ...baseEnv };
  }

  const vcVars = resolveVcVars();
  if (!vcVars) {
    throw new Error("MSVC environment bulunamadi. vcvars64.bat gerekli.");
  }

  const probeScriptPath = path.join(os.tmpdir(), "flixify-native-qt-vcvars-probe.cmd");
  fs.writeFileSync(probeScriptPath, `@echo off\r\ncall "${vcVars}" >nul\r\nset\r\n`, "utf8");

  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", probeScriptPath], {
    encoding: "utf8",
    env: baseEnv
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "MSVC ortam degiskenleri hazirlanamadi.");
  }

  const env = {};
  for (const line of result.stdout.split(/\r?\n/u)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return env;
}

export function resolveNativeQtToolchain() {
  const appRoot = resolveAppRoot();
  const cmakeBinary = resolveCmakeTool("cmake.exe");
  const cpackBinary = resolveCmakeTool("cpack.exe");
  const ninjaBinary = resolveCmakeTool("ninja.exe");
  const qtRoot = resolveQtRoot();
  const libVlcRoot = resolveLibVlcRoot();
  const nsisRoot = resolveNsisRoot();

  if (!cmakeBinary) {
    throw new Error("cmake bulunamadi.");
  }
  if (!cpackBinary) {
    throw new Error("cpack bulunamadi.");
  }
  if (!ninjaBinary) {
    throw new Error("ninja bulunamadi.");
  }
  if (!qtRoot) {
    throw new Error("QT_ROOT bulunamadi.");
  }
  if (!libVlcRoot) {
    throw new Error("LIBVLC_ROOT bulunamadi.");
  }

  const baseEnv = {
    ...process.env,
    QT_ROOT: qtRoot,
    LIBVLC_ROOT: libVlcRoot,
    FLIXIFY_API_BASE_URL: process.env.FLIXIFY_API_BASE_URL || "https://api.flixify.pro"
  };
  const env = resolveMsvcEnvironment(baseEnv);
  env.PATH = [path.dirname(cmakeBinary), path.dirname(ninjaBinary), path.join(qtRoot, "bin"), nsisRoot, env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  env.CMAKE_PREFIX_PATH = [qtRoot, env.CMAKE_PREFIX_PATH].filter(Boolean).join(path.delimiter);

  return {
    appRoot,
    env,
    cmakeBinary,
    cpackBinary,
    ninjaBinary,
    qtRoot,
    libVlcRoot,
    nsisRoot
  };
}

export function spawnChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
