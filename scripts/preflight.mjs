import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const envPath = path.join(root, ".env");
const opsEnvPath = path.join(root, "apps/ops-web/.env.local");
const webosEnvPath = path.join(root, "apps/viewer-webos/.env.local");

function parseDotenv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function fail(message) {
  console.error(`Preflight failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(envPath)) {
  fail(`missing ${envPath}`);
}

if (!fs.existsSync(opsEnvPath)) {
  fail(`missing ${opsEnvPath}`);
}

if (!fs.existsSync(webosEnvPath)) {
  fail(`missing ${webosEnvPath}`);
}

const env = parseDotenv(fs.readFileSync(envPath, "utf8"));
const opsEnv = parseDotenv(fs.readFileSync(opsEnvPath, "utf8"));
const webosEnv = parseDotenv(fs.readFileSync(webosEnvPath, "utf8"));

const requiredRootKeys = ["DATABASE_URL", "APP_JWT_SECRET", "ADMIN_EMAILS", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_JWKS_URL"];
for (const key of requiredRootKeys) {
  if (!env[key]) {
    fail(`missing ${key} in .env`);
  }
}

if (env.DATABASE_URL.includes("[YOUR_DB_PASSWORD]")) {
  fail("DATABASE_URL still contains [YOUR_DB_PASSWORD]. Replace it with the Session pooler URI from Supabase Connect.");
}

if (!env.DATABASE_URL.includes("://")) {
  fail("DATABASE_URL is not a valid connection string.");
}

if (!env.DATABASE_URL.includes(".pooler.supabase.com:5432/")) {
  console.warn("Preflight warning: DATABASE_URL does not look like a Supabase Session pooler URI on port 5432.");
}

if (!env.DATABASE_URL.includes("postgres.")) {
  console.warn("Preflight warning: pooled Supabase usernames usually look like postgres.<project-ref>.");
}

if (env.APP_JWT_SECRET.length < 32) {
  fail("APP_JWT_SECRET must be at least 32 characters.");
}

if (!env.ADMIN_EMAILS.split(",").map((item) => item.trim()).filter(Boolean).length) {
  fail("ADMIN_EMAILS must contain at least one admin email.");
}

const requiredOpsKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_API_BASE_URL"];
for (const key of requiredOpsKeys) {
  if (!opsEnv[key]) {
    fail(`missing ${key} in apps/ops-web/.env.local`);
  }
}

if (!webosEnv.VITE_API_BASE_URL) {
  fail("missing VITE_API_BASE_URL in apps/viewer-webos/.env.local");
}

console.log("Preflight passed.");
