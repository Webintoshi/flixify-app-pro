import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const distDir = path.join(appRoot, "dist-electron");
const targetDir = path.resolve(appRoot, "../viewer-webos/public/downloads");
const targetPath = path.join(targetDir, "flixify-windows.exe");
const updateManifestPath = path.resolve(appRoot, "../viewer-webos/public/app-update-manifest.json");
const packageJsonPath = path.join(appRoot, "package.json");
const envFilePaths = [".env.production.local", ".env.production", ".env.local", ".env"].map((name) =>
  path.resolve(workspaceRoot, name)
);

async function readPackageVersion() {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function normalizeWebAppUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

async function readEnvFiles() {
  const merged = {};

  for (const filePath of envFilePaths) {
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/u);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = parseEnvValue(trimmed.slice(separatorIndex + 1));

        if (key && !(key in merged)) {
          merged[key] = value;
        }
      }
    } catch {
      // Optional env file, ignore read/parsing errors.
    }
  }

  return merged;
}

async function resolveWebAppUrl() {
  const envFiles = await readEnvFiles();
  const candidates = [
    { source: "FLIXIFY_WEB_APP_URL (process env)", value: process.env.FLIXIFY_WEB_APP_URL },
    { source: "PUBLIC_APP_BASE_URL (process env)", value: process.env.PUBLIC_APP_BASE_URL },
    { source: "VITE_WEB_APP_URL (process env)", value: process.env.VITE_WEB_APP_URL },
    { source: "FLIXIFY_WEB_APP_URL (.env*)", value: envFiles.FLIXIFY_WEB_APP_URL },
    { source: "PUBLIC_APP_BASE_URL (.env*)", value: envFiles.PUBLIC_APP_BASE_URL },
    { source: "VITE_WEB_APP_URL (.env*)", value: envFiles.VITE_WEB_APP_URL }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWebAppUrl(candidate.value);
    if (normalized) {
      return {
        value: normalized,
        source: candidate.source
      };
    }
  }

  return null;
}

function buildCandidateScore(name, version) {
  if (!name.endsWith(".exe") || name.endsWith(".blockmap")) {
    return -1;
  }

  if (!name.startsWith("Flixify-Pro-")) {
    return -1;
  }

  let score = 0;

  if (version && name.includes(`-${version}`)) {
    score += 1000;
  }

  if (name.startsWith("Flixify-Pro-Setup-")) {
    score += 100;
  }

  if (name.includes("-x64.exe")) {
    score += 50;
  } else if (!name.includes("-arm64")) {
    score += 30;
  }

  if (name.includes("-arm64")) {
    score -= 200;
  }

  return score;
}

async function resolveSourceArtifact() {
  const version = await readPackageVersion();
  const entries = await readdir(distDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const score = buildCandidateScore(entry.name, version);
    if (score < 0) {
      continue;
    }

    const fullPath = path.join(distDir, entry.name);
    const fileStats = await stat(fullPath);
    candidates.push({
      name: entry.name,
      path: fullPath,
      score,
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

const sourceArtifact = await resolveSourceArtifact();
const packageVersion = await readPackageVersion();

if (!sourceArtifact) {
  throw new Error(
    `Windows package bulunamadi. Once dist-electron altinda bir Windows .exe uretin. Beklenen dizin: ${distDir}`
  );
}

await mkdir(targetDir, { recursive: true });
await copyFile(sourceArtifact.path, targetPath);

console.log(`Published Windows web download: ${sourceArtifact.name} -> ${targetPath}`);

const resolvedWebAppUrl = await resolveWebAppUrl();
if (resolvedWebAppUrl?.value && packageVersion) {
  const manifest = {
    platforms: {
      "windows-desktop": {
        latestVersion: packageVersion,
        downloadUrl: new URL("/downloads/flixify-windows.exe", resolvedWebAppUrl.value).toString()
      }
    }
  };

  await writeFile(updateManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `Published app update manifest: ${updateManifestPath} (${resolvedWebAppUrl.value} via ${resolvedWebAppUrl.source})`
  );
} else {
  console.log("Skipped app update manifest publish: FLIXIFY_WEB_APP_URL/PUBLIC_APP_BASE_URL tanimli degil.");
}
