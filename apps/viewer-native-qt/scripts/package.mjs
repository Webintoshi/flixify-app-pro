import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

spawnChecked(cmakeBinary, ["--preset", preset], { cwd: appRoot, env });
spawnChecked(cmakeBinary, ["--build", "--preset", preset], { cwd: appRoot, env });

if (process.platform === "darwin") {
  packageMacOS();
} else {
  packageWindows();
}
