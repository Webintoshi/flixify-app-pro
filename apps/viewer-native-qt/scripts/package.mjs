import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveNativeQtToolchain, resolvePreset, spawnChecked } from "./toolchain.mjs";

const preset = resolvePreset("windows-x64-release", "macos-universal-release");
const {
  appRoot,
  cmakeBinary,
  buildCmakeBinary,
  cpackBinary,
  env,
  androidDeployQtBinary,
  androidSdkRoot,
  javaHome
} = resolveNativeQtToolchain(preset);
const buildDir = path.join(appRoot, "build", preset);
const packageDir = path.join(appRoot, "dist", preset);
const buildType = preset.includes("debug") ? "Debug" : "Release";
const androidPreset = preset.startsWith("android");

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

function readViewerVersion() {
  return JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).version;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? 1}.`);
  }

  return result;
}

function runCaptured(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} failed.`);
  }

  return result.stdout.trim();
}

function hasMacCodeSigningConfig() {
  return Boolean(env.MACOS_CERT_P12_BASE64 && env.MACOS_CERT_PASSWORD && env.MACOS_KEYCHAIN_PASSWORD);
}

function hasMacNotaryConfig() {
  return Boolean(env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER_ID && env.APPLE_API_PRIVATE_KEY && env.APPLE_TEAM_ID);
}

function resolveMacCodesignIdentity() {
  if (env.MACOS_CODESIGN_IDENTITY) {
    return env.MACOS_CODESIGN_IDENTITY;
  }

  const output = runCaptured("security", ["find-identity", "-v", "-p", "codesigning"]);
  const lines = output.split(/\r?\n/u);
  for (const line of lines) {
    if (!line.includes("Developer ID Application")) {
      continue;
    }

    const match = line.match(/"([^"]+)"/u);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error("Developer ID Application identity bulunamadi.");
}

function collectFiles(rootDir, predicate) {
  const items = [];
  if (!fs.existsSync(rootDir)) {
    return items;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      items.push(...collectFiles(entryPath, predicate));
      continue;
    }

    if (predicate(entryPath)) {
      items.push(entryPath);
    }
  }

  return items;
}

function signMacPath(targetPath, identity, extraArgs = []) {
  runChecked(
    "codesign",
    ["--force", "--timestamp", "--options", "runtime", "--sign", identity, ...extraArgs, targetPath],
    { env }
  );
}

function signMacBundle(appBundle, identity) {
  const vlcRoot = path.join(appBundle, "Contents", "MacOS", "vlc");
  const dylibs = collectFiles(vlcRoot, (entryPath) => entryPath.endsWith(".dylib"));

  for (const dylibPath of dylibs) {
    signMacPath(dylibPath, identity);
  }

  signMacPath(appBundle, identity, ["--deep"]);
}

function notarizeMacArtifact(appBundle, dmgPath) {
  if (!hasMacNotaryConfig()) {
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flixify-notary-"));
  const keyFile = path.join(tempDir, "AuthKey.p8");

  fs.writeFileSync(keyFile, `${env.APPLE_API_PRIVATE_KEY}\n`, "utf8");

  try {
    runChecked(
      "xcrun",
      [
        "notarytool",
        "submit",
        dmgPath,
        "--wait",
        "--key",
        keyFile,
        "--key-id",
        env.APPLE_API_KEY_ID,
        "--issuer",
        env.APPLE_API_ISSUER_ID,
        "--team-id",
        env.APPLE_TEAM_ID
      ],
      { env }
    );
    runChecked("xcrun", ["stapler", "staple", appBundle], { env });
    runChecked("xcrun", ["stapler", "staple", dmgPath], { env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function packageWindows() {
  sanitizeQtDeployScript();
  fs.mkdirSync(packageDir, { recursive: true });
  spawnChecked(
    cpackBinary,
    ["--config", path.join(buildDir, "CPackConfig.cmake"), "-C", buildType, "-B", packageDir],
    {
      cwd: buildDir,
      env
    }
  );
}

function packageMacOS() {
  const stageRoot = path.join(packageDir, "stage");
  const version = readViewerVersion();
  const appBundle = path.join(stageRoot, "Flixify Pro.app");
  const dmgPath = path.join(packageDir, `Flixify-Pro-${version}-macos-universal.dmg`);

  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.rmSync(dmgPath, { force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  spawnChecked(cmakeBinary, ["--install", buildDir, "--config", buildType, "--prefix", stageRoot], {
    cwd: appRoot,
    env
  });

  if (!fs.existsSync(appBundle)) {
    throw new Error(`macOS app bundle not found at ${appBundle}.`);
  }

  if (hasMacCodeSigningConfig()) {
    const identity = resolveMacCodesignIdentity();
    signMacBundle(appBundle, identity);
  }

  runChecked(
    "hdiutil",
    ["create", "-volname", "Flixify Pro", "-srcfolder", stageRoot, "-ov", "-format", "UDZO", dmgPath],
    { env }
  );

  if (hasMacCodeSigningConfig()) {
    signMacPath(dmgPath, resolveMacCodesignIdentity());
    notarizeMacArtifact(appBundle, dmgPath);
  }
}

function copyNewestFile(sourceDir, destinationPath) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Android paket cikti dizini bulunamadi: ${sourceDir}`);
  }

  const files = fs
    .readdirSync(sourceDir)
    .filter((entry) => entry.endsWith(".apk"))
    .map((entry) => path.join(sourceDir, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (!files.length) {
    throw new Error(`APK bulunamadi: ${sourceDir}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(files[0], destinationPath);
}

function findNewestApk(rootDirs, minimumMtimeMs = 0) {
  const candidates = [];

  for (const rootDir of rootDirs) {
    if (!rootDir || !fs.existsSync(rootDir)) {
      continue;
    }

    const apkFiles = collectFiles(rootDir, (entryPath) => entryPath.endsWith(".apk"));
    for (const apkPath of apkFiles) {
      const stats = fs.statSync(apkPath);
      if (stats.mtimeMs >= minimumMtimeMs) {
        candidates.push({ path: apkPath, mtimeMs: stats.mtimeMs });
      }
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.path ?? null;
}

function ensureAndroidApplicationBinary(deploymentSettingsPath, buildDir, androidBuildDir) {
  const deploymentSettings = JSON.parse(fs.readFileSync(deploymentSettingsPath, "utf8"));
  const applicationBinary = deploymentSettings["application-binary"];
  const architectures = Object.keys(deploymentSettings.architectures ?? {});

  if (!applicationBinary || !architectures.length) {
    return;
  }

  for (const abi of architectures) {
    const expectedName = `lib${applicationBinary}_${abi}.so`;
    const sourceCandidates = [
      path.join(buildDir, expectedName),
      path.join(buildDir, `lib${applicationBinary}.so`)
    ];
    const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));

    if (!sourcePath) {
      continue;
    }

    const destinationDir = path.join(androidBuildDir, "libs", abi);
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(sourcePath, path.join(destinationDir, expectedName));
  }
}

function androidAbiLabel(deploymentSettingsPath, preset) {
  try {
    const deploymentSettings = JSON.parse(fs.readFileSync(deploymentSettingsPath, "utf8"));
    const firstAbi = Object.keys(deploymentSettings.architectures ?? {})[0];
    if (firstAbi) {
      return firstAbi.replace(/-v8a$/u, "");
    }
  } catch {
  }

  if (preset.includes("x86_64")) {
    return "x86_64";
  }

  return "arm64";
}

function packageAndroid() {
  const startedAtMs = Date.now();
  const deploymentSettingsPath = path.join(buildDir, "android-FlixifyNativeQt-deployment-settings.json");
  if (!fs.existsSync(deploymentSettingsPath)) {
    throw new Error(`Android deployment ayarlari bulunamadi: ${deploymentSettingsPath}`);
  }

  const androidBuildDir = path.join(buildDir, "android-build");
  try {
    fs.rmSync(androidBuildDir, { recursive: true, force: true });
  } catch {
  }
  fs.mkdirSync(packageDir, { recursive: true });
  ensureAndroidApplicationBinary(deploymentSettingsPath, buildDir, androidBuildDir);

  const androidPlatform = process.env.FLIXIFY_ANDROID_PLATFORM || "android-35";
  const androidModeFlag = buildType === "Debug" ? "--debug" : "--release";
  const args = [
    "--input", deploymentSettingsPath,
    "--output", androidBuildDir,
    "--apk",
    androidModeFlag,
    "--gradle",
    "--android-platform", androidPlatform,
    "--jdk", javaHome,
    "--verbose"
  ];

  const result = spawnSync(androidDeployQtBinary, args, {
    cwd: buildDir,
    env,
    encoding: "utf8"
  });

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (combinedOutput.length) {
    process.stdout.write(`${combinedOutput}\n`);
  }

  const apkVariantDir = path.join(
    androidBuildDir,
    "build",
    "outputs",
    "apk",
    buildType.toLowerCase()
  );
  const abiLabel = androidAbiLabel(deploymentSettingsPath, preset);
  const packagedApkPath = path.join(
    packageDir,
    `Flixify-Pro-TV-android-${abiLabel}-${buildType.toLowerCase()}.apk`
  );

  const freshestApk = findNewestApk(
    [apkVariantDir, androidBuildDir, buildDir],
    startedAtMs - 1000
  );

  const apkPathFromOutput = (() => {
    const match = combinedOutput.match(/-- File:\s*(.+?\.apk)/i);
    if (!match || !match[1]) {
      return null;
    }

    const candidate = match[1].trim().replace(/^["']|["']$/g, "");
    return fs.existsSync(candidate) ? candidate : null;
  })();

  if (freshestApk || apkPathFromOutput) {
    const apkToCopy = freshestApk || apkPathFromOutput;
    fs.mkdirSync(path.dirname(packagedApkPath), { recursive: true });
    fs.copyFileSync(apkToCopy, packagedApkPath);
    if (result.status !== 0) {
      process.stdout.write(
        `androiddeployqt nonzero döndü ama geçerli APK üretildi, paketleme sürdürüldü: ${apkToCopy}\n`
      );
    }
    return;
  }

  if (result.status !== 0) {
    throw new Error(combinedOutput || `androiddeployqt failed with status ${result.status ?? 1}.`);
  }

  throw new Error(`APK cikisi bulunamadi: ${apkVariantDir}`);
}

spawnChecked(cmakeBinary, ["--preset", preset], { cwd: appRoot, env });
spawnChecked(androidPreset ? buildCmakeBinary : cmakeBinary, ["--build", "--preset", preset], { cwd: appRoot, env });

if (androidPreset) {
  packageAndroid();
} else if (process.platform === "darwin") {
  packageMacOS();
} else {
  packageWindows();
}
