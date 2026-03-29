import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function existingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

function commandExists(command, args = ["--version"]) {
  if (!command) {
    return false;
  }

  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false
  });

  return !result.error && result.status === 0;
}

function captureStdout(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: false
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function normalizeQtRoot(candidate) {
  if (!candidate) {
    return null;
  }

  const resolved = path.resolve(candidate);
  const normalized = path.normalize(resolved);
  const knownSuffixes = [
    path.join("lib", "cmake", "Qt6"),
    path.join("lib64", "cmake", "Qt6")
  ];

  for (const suffix of knownSuffixes) {
    if (normalized.endsWith(suffix)) {
      return normalized.slice(0, -suffix.length - 1);
    }
  }

  if (fs.existsSync(path.join(normalized, "bin"))) {
    return normalized;
  }

  return null;
}

function compareVersionNames(left, right) {
  const leftParts = left.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const rightParts = right.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function findQtInstallations(baseDir, platformFolders) {
  if (!baseDir || !fs.existsSync(baseDir)) {
    return [];
  }

  const roots = [];
  const versionDirs = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionNames);

  for (const versionDir of versionDirs) {
    for (const platformFolder of platformFolders) {
      const candidate = normalizeQtRoot(path.join(baseDir, versionDir, platformFolder));
      if (candidate && !roots.includes(candidate)) {
        roots.push(candidate);
      }
    }
  }

  return roots;
}

function resolveToolBinary(baseName, windowsFallbacks = []) {
  const envNames = [
    `${baseName.toUpperCase()}_BIN`,
    `${baseName.toUpperCase()}_EXECUTABLE`,
    `${baseName.toUpperCase()}_PATH`
  ];
  const executableNames = process.platform === "win32" ? [`${baseName}.exe`, baseName] : [baseName];
  const envCandidates = envNames.flatMap((name) => {
    const value = process.env[name];
    if (!value) {
      return [];
    }

    if (fs.existsSync(value)) {
      return [path.resolve(value)];
    }

    return [value];
  });

  for (const candidate of [...envCandidates, ...windowsFallbacks]) {
    if (!candidate) {
      continue;
    }

    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }

    if (commandExists(candidate)) {
      return candidate;
    }
  }

  for (const executableName of executableNames) {
    if (commandExists(executableName)) {
      return executableName;
    }
  }

  return null;
}

function normalizeLibVlcRoot(candidate) {
  if (!candidate) {
    return null;
  }

  let resolved = path.resolve(candidate);
  if (resolved.endsWith(".app")) {
    resolved = path.join(resolved, "Contents", "MacOS");
  }

  if (
    process.platform === "darwin" &&
    path.basename(resolved) === "lib" &&
    fs.existsSync(path.join(resolved, "libvlc.dylib"))
  ) {
    resolved = path.dirname(resolved);
  }

  return resolved;
}

function libVlcRootLooksValid(candidate) {
  if (!candidate) {
    return false;
  }

  if (process.platform === "win32") {
    return (
      fs.existsSync(path.join(candidate, "libvlc.dll")) ||
      fs.existsSync(path.join(candidate, "lib", "libvlc.dll"))
    );
  }

  if (process.platform === "darwin") {
    return (
      fs.existsSync(path.join(candidate, "lib", "libvlc.dylib")) ||
      fs.existsSync(path.join(candidate, "libvlc.dylib"))
    );
  }

  return (
    fs.existsSync(path.join(candidate, "lib", "libvlc.so")) ||
    fs.existsSync(path.join(candidate, "libvlc.so"))
  );
}

function resolveQtRoot() {
  const derivedFromQt6Dir = normalizeQtRoot(process.env.Qt6_DIR ?? process.env.QT6_DIR ?? process.env.QT_DIR);
  const homeQtDir = path.join(os.homedir(), "Qt");
  const macPlatformFolders = ["macos", "clang_64"];
  const windowsPlatformFolders = ["msvc2022_64", "mingw_64"];

  const candidates = [
    normalizeQtRoot(process.env.QT_ROOT),
    normalizeQtRoot(process.env.QTDIR),
    derivedFromQt6Dir
  ];

  if (process.platform === "win32") {
    candidates.push(...findQtInstallations("C:\\Qt", windowsPlatformFolders));
  } else if (process.platform === "darwin") {
    candidates.push(...findQtInstallations(homeQtDir, macPlatformFolders));
    const brewQtPrefix = captureStdout("brew", ["--prefix", "qt"]);
    candidates.push(normalizeQtRoot(brewQtPrefix));
  } else {
    candidates.push(normalizeQtRoot(captureStdout("brew", ["--prefix", "qt"])));
    candidates.push(normalizeQtRoot("/usr/local/opt/qt"));
    candidates.push(normalizeQtRoot("/opt/homebrew/opt/qt"));
  }

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function isAndroidPreset(preset) {
  return typeof preset === "string" && preset.startsWith("android");
}

function resolveAndroidSdkRoot() {
  return existingPath([
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(os.homedir(), "AppData", "Local", "Android", "Sdk")
  ]);
}

function resolveAndroidNdkRoot(androidSdkRoot) {
  const explicit = existingPath([
    process.env.ANDROID_NDK_ROOT,
    process.env.ANDROID_NDK_HOME
  ]);
  if (explicit) {
    return explicit;
  }

  if (!androidSdkRoot) {
    return null;
  }

  const ndkBaseDir = path.join(androidSdkRoot, "ndk");
  if (!fs.existsSync(ndkBaseDir)) {
    return null;
  }

  return fs
    .readdirSync(ndkBaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(ndkBaseDir, entry.name))
    .sort((left, right) => compareVersionNames(path.basename(left), path.basename(right)))[0] ?? null;
}

function resolveJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    "C:\\Program Files\\Microsoft\\jdk-17.0.18.8-hotspot",
    "C:\\Program Files\\Microsoft\\jdk-17.0.17.10-hotspot",
    "C:\\Program Files\\Microsoft\\jdk-17.0.16.8-hotspot"
  ];

  return existingPath(candidates);
}

function resolveAndroidQtRoot(preset = "") {
  const envQtRoot = normalizeQtRoot(process.env.QT_ANDROID_ROOT);
  if (envQtRoot) {
    return envQtRoot;
  }

  const preferredFolders = preset.includes("x86_64")
    ? ["android_x86_64", "android_arm64_v8a", "android_armv7"]
    : ["android_arm64_v8a", "android_x86_64", "android_armv7"];
  const candidates = findQtInstallations("C:\\Qt", preferredFolders);
  return candidates[0] ?? null;
}

function resolveQtHostRoot() {
  const envQtHostRoot = normalizeQtRoot(process.env.QT_HOST_PATH ?? process.env.QT_HOST_ROOT);
  if (envQtHostRoot) {
    return envQtHostRoot;
  }

  const candidates = findQtInstallations("C:\\Qt", ["msvc2022_64", "mingw_64"]);
  return candidates[0] ?? null;
}

function resolveLibVlcRoot() {
  const candidates = [normalizeLibVlcRoot(process.env.LIBVLC_ROOT)];

  if (process.platform === "win32") {
    candidates.push(
      normalizeLibVlcRoot("C:\\Program Files\\VideoLAN\\VLC"),
      normalizeLibVlcRoot("C:\\Program Files (x86)\\VideoLAN\\VLC")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      normalizeLibVlcRoot("/Applications/VLC.app"),
      normalizeLibVlcRoot(path.join(os.homedir(), "Applications", "VLC.app"))
    );
  } else {
    candidates.push(
      normalizeLibVlcRoot("/usr/lib/vlc"),
      normalizeLibVlcRoot("/usr/local/lib/vlc"),
      normalizeLibVlcRoot("/opt/homebrew/Cellar/vlc")
    );
  }

  for (const candidate of candidates) {
    if (candidate && libVlcRootLooksValid(candidate)) {
      return candidate;
    }
  }

  return null;
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

function resolveToolDirectory(binary) {
  if (!binary) {
    return null;
  }

  if (!binary.includes(path.sep) && !binary.includes("/")) {
    return null;
  }

  return path.dirname(binary);
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

export function resolveNativeQtToolchain(preset = resolvePreset()) {
  const appRoot = resolveAppRoot();
  const androidPreset = isAndroidPreset(preset);
  const cmakeFallbacks = [path.join(process.env.APPDATA ?? "", "Python", "Python314", "Scripts", "cmake.exe")];
  const cpackFallbacks = [path.join(process.env.APPDATA ?? "", "Python", "Python314", "Scripts", "cpack.exe")];
  const ninjaFallbacks = [path.join(process.env.APPDATA ?? "", "Python", "Python314", "Scripts", "ninja.exe")];
  const rawCmakeBinary = resolveToolBinary("cmake", cmakeFallbacks);
  const cpackBinary = androidPreset ? null : resolveToolBinary("cpack", cpackFallbacks);
  const ninjaBinary = resolveToolBinary("ninja", ninjaFallbacks);
  const nsisRoot = androidPreset ? null : resolveNsisRoot();

  if (!ninjaBinary) {
    throw new Error("ninja bulunamadi.");
  }

  if (androidPreset) {
    const qtRoot = resolveAndroidQtRoot(preset);
    const qtHostRoot = resolveQtHostRoot();
    const androidSdkRoot = resolveAndroidSdkRoot();
    const androidNdkRoot = resolveAndroidNdkRoot(androidSdkRoot);
    const javaHome = resolveJavaHome();

    if (!qtRoot) {
      throw new Error("QT_ANDROID_ROOT bulunamadi.");
    }
    if (!qtHostRoot) {
      throw new Error("QT_HOST_PATH bulunamadi.");
    }
    if (!androidSdkRoot) {
      throw new Error("ANDROID_SDK_ROOT bulunamadi.");
    }
    if (!androidNdkRoot) {
      throw new Error("ANDROID_NDK_ROOT bulunamadi.");
    }
    if (!javaHome) {
      throw new Error("JAVA_HOME bulunamadi.");
    }

    const qtCmakeBinary = existingPath([
      path.join(qtRoot, "bin", "qt-cmake.bat"),
      path.join(qtRoot, "bin", "qt-cmake")
    ]);
    if (!qtCmakeBinary) {
      throw new Error("qt-cmake Android kitinde bulunamadi.");
    }

    const androidDeployQtBinary = existingPath([
      path.join(qtHostRoot, "bin", "androiddeployqt.exe"),
      path.join(qtHostRoot, "bin", "androiddeployqt6.exe")
    ]);
    if (!androidDeployQtBinary) {
      throw new Error("androiddeployqt bulunamadi.");
    }

    const baseEnv = {
      ...process.env,
      QT_ROOT: qtRoot,
      QT_HOST_PATH: qtHostRoot,
      JAVA_HOME: javaHome,
      ANDROID_HOME: androidSdkRoot,
      ANDROID_SDK_ROOT: androidSdkRoot,
      ANDROID_NDK_ROOT: androidNdkRoot,
      ANDROID_NDK_HOME: androidNdkRoot,
      FLIXIFY_API_BASE_URL: process.env.FLIXIFY_API_BASE_URL || "https://api.flixify.pro"
    };

    baseEnv.PATH = [
      path.join(qtRoot, "bin"),
      path.join(qtHostRoot, "bin"),
      path.join(javaHome, "bin"),
      path.join(androidSdkRoot, "platform-tools"),
      path.join(androidSdkRoot, "cmdline-tools", "latest", "bin"),
      resolveToolDirectory(ninjaBinary),
      resolveToolDirectory(rawCmakeBinary),
      baseEnv.PATH
    ]
      .filter(Boolean)
      .join(path.delimiter);
    baseEnv.CMAKE_PREFIX_PATH = [qtRoot, baseEnv.CMAKE_PREFIX_PATH].filter(Boolean).join(path.delimiter);

    return {
      appRoot,
      env: baseEnv,
      cmakeBinary: qtCmakeBinary,
      buildCmakeBinary: rawCmakeBinary,
      cpackBinary,
      ninjaBinary,
      qtRoot,
      qtHostRoot,
      androidSdkRoot,
      androidNdkRoot,
      javaHome,
      androidDeployQtBinary,
      libVlcRoot: null,
      nsisRoot
    };
  }

  const cmakeBinary = rawCmakeBinary;
  const qtRoot = resolveQtRoot();
  const libVlcRoot = resolveLibVlcRoot();

  if (!cmakeBinary) {
    throw new Error("cmake bulunamadi.");
  }
  if (!cpackBinary) {
    throw new Error("cpack bulunamadi.");
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

  env.PATH = [
    resolveToolDirectory(cmakeBinary),
    resolveToolDirectory(ninjaBinary),
    path.join(qtRoot, "bin"),
    process.platform === "win32" ? nsisRoot : null,
    env.PATH
  ]
    .filter(Boolean)
    .join(path.delimiter);
  env.CMAKE_PREFIX_PATH = [qtRoot, env.CMAKE_PREFIX_PATH].filter(Boolean).join(path.delimiter);

  return {
    appRoot,
    env,
    cmakeBinary,
    buildCmakeBinary: cmakeBinary,
    cpackBinary,
    ninjaBinary,
    qtRoot,
    libVlcRoot,
    nsisRoot
  };
}

export function spawnChecked(command, args, options = {}) {
  const isWindowsBatch =
    process.platform === "win32" &&
    typeof command === "string" &&
    /\.(bat|cmd)$/iu.test(command);

  const result = isWindowsBatch
    ? spawnSync(command, args, {
        stdio: "inherit",
        shell: true,
        ...options
      })
    : spawnSync(command, args, {
        stdio: "inherit",
        ...options
      });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
