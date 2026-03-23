import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const distDir = path.join(appRoot, "dist", "windows-x64-release");
const targetDir = path.resolve(appRoot, "../viewer-webos/public/downloads");
const targetPath = path.join(targetDir, "flixify-windows.exe");
const updateManifestPath = path.resolve(appRoot, "../viewer-webos/public/app-update-manifest.json");
const packageJsonPath = path.join(appRoot, "package.json");
const envFilePaths = [".env.production.local", ".env.production", ".env.local", ".env"].map((name) =>
  path.resolve(workspaceRoot, name)
);

async function readPackageVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw).version?.trim() ?? null;
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

async function resolveInstallerArtifact() {
  const version = await readPackageVersion();
  const entries = await readdir(distDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".exe")) {
      continue;
    }

    const fullPath = path.join(distDir, entry.name);
    const fileStats = await stat(fullPath);
    candidates.push({
      name: entry.name,
      path: fullPath,
      score:
        (entry.name.includes(version ?? "") ? 100 : 0) +
        (entry.name.toLowerCase().includes("setup") ? 50 : 0) +
        (entry.name.toLowerCase().includes("native") ? 10 : 0),
      mtimeMs: fileStats.mtimeMs
    });
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.mtimeMs - left.mtimeMs;
  });

  return candidates[0] ?? null;
}

const artifact = await resolveInstallerArtifact();
if (!artifact) {
  throw new Error(`Native Windows installer bulunamadi: ${distDir}`);
}

await mkdir(targetDir, { recursive: true });
await copyFile(artifact.path, targetPath);

const packageVersion = await readPackageVersion();
const webAppUrl = await resolveWebAppUrl();
if (packageVersion && webAppUrl) {
  const downloadUrl = new URL("/downloads/flixify-windows.exe", webAppUrl).toString();
  const manifest = {
    platforms: {
      "windows-desktop": {
        latestVersion: packageVersion,
        downloadUrl
      },
      "windows-native-qt": {
        latestVersion: packageVersion,
        downloadUrl
      }
    }
  };
  await writeFile(updateManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
