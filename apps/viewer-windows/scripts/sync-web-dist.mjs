import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const sourceDist = path.resolve(appRoot, "../viewer-webos/dist");
const targetDist = path.resolve(appRoot, "web-dist");
const args = new Set(process.argv.slice(2));
const requireApiBaseUrl = args.has("--require-api-base-url");
const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const envFilePaths = [".env.production.local", ".env.production", ".env.local", ".env"].map((name) =>
  path.resolve(workspaceRoot, name)
);

function normalizeApiBaseUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
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

function isLocalApiBaseUrl(value) {
  try {
    const parsed = new URL(value);
    return localHostnames.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function resolveApiBaseUrl() {
  const envFiles = await readEnvFiles();
  const candidates = [
    { source: "FLIXIFY_API_BASE_URL (process env)", value: process.env.FLIXIFY_API_BASE_URL },
    { source: "PUBLIC_API_BASE_URL (process env)", value: process.env.PUBLIC_API_BASE_URL },
    { source: "NEXT_PUBLIC_API_BASE_URL (process env)", value: process.env.NEXT_PUBLIC_API_BASE_URL },
    { source: "FLIXIFY_API_BASE_URL (.env*)", value: envFiles.FLIXIFY_API_BASE_URL },
    { source: "PUBLIC_API_BASE_URL (.env*)", value: envFiles.PUBLIC_API_BASE_URL },
    { source: "NEXT_PUBLIC_API_BASE_URL (.env*)", value: envFiles.NEXT_PUBLIC_API_BASE_URL }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeApiBaseUrl(candidate.value);
    if (normalized) {
      return {
        value: normalized,
        source: candidate.source
      };
    }
  }

  return null;
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

await mkdir(appRoot, { recursive: true });
await rm(targetDist, { recursive: true, force: true });
await cp(sourceDist, targetDist, { recursive: true });
// Keep installer bundles out of the desktop wrapper payload.
// Download artifacts are served by web deployment, not shipped inside Electron packages.
await rm(path.join(targetDist, "downloads"), { recursive: true, force: true });

const resolvedApiBase = await resolveApiBaseUrl();
const resolvedWebAppUrl = await resolveWebAppUrl();
if (requireApiBaseUrl && !resolvedApiBase?.value) {
  throw new Error(
    "Production packaging icin FLIXIFY_API_BASE_URL veya PUBLIC_API_BASE_URL zorunludur. Ornek: https://api.example.com"
  );
}

if (requireApiBaseUrl && resolvedApiBase?.value && isLocalApiBaseUrl(resolvedApiBase.value)) {
  throw new Error(
    `Production packaging local API ile yapilamaz (${resolvedApiBase.value}). Gecerli public API girin.`
  );
}

const runtimeApiBaseUrl = resolvedApiBase?.value ?? "http://localhost:4000";
const runtimeConfigPath = path.join(targetDist, "app-config.json");
const runtimeConfig = {
  apiBaseUrl: runtimeApiBaseUrl
};
if (resolvedWebAppUrl?.value) {
  runtimeConfig.webAppUrl = resolvedWebAppUrl.value;
}
await writeFile(
  runtimeConfigPath,
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  "utf8"
);

console.log(`Synced ${sourceDist} -> ${targetDist}`);
console.log(
  `Runtime API config written to ${runtimeConfigPath}: ${runtimeApiBaseUrl}` +
    (resolvedApiBase?.source ? ` (${resolvedApiBase.source})` : " (default dev fallback)")
);
if (resolvedWebAppUrl?.value) {
  console.log(
    `Runtime Web App URL enabled: ${resolvedWebAppUrl.value}` +
      (resolvedWebAppUrl.source ? ` (${resolvedWebAppUrl.source})` : "")
  );
}
