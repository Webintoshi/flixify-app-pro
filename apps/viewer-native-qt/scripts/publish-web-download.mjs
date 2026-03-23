import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const distDir = path.join(appRoot, "dist", "windows-x64-release");
const targetDir = path.resolve(appRoot, "../viewer-webos/public/downloads");
const targetFilename = "flixify-windows.exe";
const targetPath = path.join(targetDir, targetFilename);
const updateManifestPath = path.resolve(appRoot, "../viewer-webos/public/app-update-manifest.json");
const packageJsonPath = path.join(appRoot, "package.json");
const platformKey = "windows-native-qt";
const envFilePaths = [".env.production.local", ".env.production", ".env.local", ".env"].map((name) =>
  path.resolve(workspaceRoot, name)
);

async function readPackageVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  const version = JSON.parse(raw).version;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : null;
}

function normalizeWebAppUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function resolveWebAppUrl() {
  const values = [
    process.env.FLIXIFY_WEB_APP_URL,
    process.env.PUBLIC_APP_BASE_URL,
    process.env.VITE_WEB_APP_URL
  ];
  const allowedKeys = new Set(["FLIXIFY_WEB_APP_URL", "PUBLIC_APP_BASE_URL", "VITE_WEB_APP_URL"]);

  for (const filePath of envFilePaths) {
    try {
      const content = await readFile(filePath, "utf8");
      for (const line of content.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        if (allowedKeys.has(key)) {
          values.push(parseEnvValue(trimmed.slice(separatorIndex + 1)));
        }
      }
    } catch {
      // Optional env file.
    }
  }

  for (const candidate of values) {
    const normalized = normalizeWebAppUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "https://app.flixify.pro/";
}

function createEmptyManifest() {
  return { platforms: {} };
}

async function readManifest() {
  try {
    const raw = await readFile(updateManifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const platforms =
      parsed && typeof parsed === "object" && parsed.platforms && typeof parsed.platforms === "object"
        ? parsed.platforms
        : null;

    return platforms ? { platforms: { ...platforms } } : createEmptyManifest();
  } catch {
    return createEmptyManifest();
  }
}

async function resolveInstallerArtifact(version) {
  if (!version) {
    throw new Error(`Native Qt package version okunamadi: ${packageJsonPath}`);
  }

  const filename = `Flixify-Pro-Setup-${version}-x64.exe`;
  const artifactPath = path.join(distDir, filename);
  const fileStats = await stat(artifactPath).catch(() => null);
  if (!fileStats?.isFile() || fileStats.size <= 0) {
    throw new Error(
      `Native Qt installer bulunamadi veya bos. Beklenen exact artifact: ${artifactPath}`
    );
  }

  return {
    name: filename,
    path: artifactPath
  };
}

function buildDownloadUrl(webAppUrl, version) {
  const downloadUrl = new URL(`/downloads/${targetFilename}`, webAppUrl);
  downloadUrl.searchParams.set("v", version);
  return downloadUrl.toString();
}

const packageVersion = await readPackageVersion();
const artifact = await resolveInstallerArtifact(packageVersion);
if (!artifact) {
  throw new Error(`Native Windows installer bulunamadi: ${distDir}`);
}

await mkdir(targetDir, { recursive: true });
await copyFile(artifact.path, targetPath);
console.log(`Published Qt native web download: ${artifact.name} -> ${targetPath}`);

const webAppUrl = await resolveWebAppUrl();
if (packageVersion && webAppUrl) {
  const manifest = await readManifest();
  delete manifest.platforms["windows-desktop"];
  manifest.platforms[platformKey] = {
    latestVersion: packageVersion,
    downloadUrl: buildDownloadUrl(webAppUrl, packageVersion)
  };
  await writeFile(updateManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated app update manifest entry: ${platformKey}`);
}
