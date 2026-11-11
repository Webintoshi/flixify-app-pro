import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import ffmpegStatic from "ffmpeg-static";
import { z } from "zod";
import { parseTrustedProxyCidrs } from "./trusted-proxy.js";
import { validatePhoneAuthConfiguration } from './phone-auth-config.js';
import { resolveEmailAuthConfiguration } from "./email-auth-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config();
config({
  path: path.resolve(__dirname, "../../../.env")
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_JWT_SECRET: z.string().min(32),
  REGISTRATION_GUARD_SECRET: z.string().min(32),
  APP_DEMO_MODE: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_EMAILS: z.string().min(3),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DEVICE_LOGIN_LOCAL_WEB_ORIGIN: z.enum(['http://127.0.0.1:3192','http://localhost:3192']).optional(),
  PHONE_AUTH_ENABLED: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  PHONE_AUTH_PROVIDER_DIAGNOSTICS: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  PHONE_AUTH_LOCAL_ONLY: z.enum(['true','false']).default('true').transform(value=>value==='true'),
  PHONE_AUTH_SECRET: z.string().min(32).optional(),
  PHONE_AUTH_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:3192,http://localhost:3192').transform(value=>value.split(',').map(item=>item.trim()).filter(Boolean)),
  VATANSMS_WHATSAPP_API_KEY: z.string().min(1).optional(),
  VATANSMS_WHATSAPP_REG_ID: z.string().regex(/^[0-9]{1,30}$/).optional(),
  VATANSMS_WHATSAPP_BASE_URL: z.literal('https://api.toplusmspaketleri.com').default('https://api.toplusmspaketleri.com'),
  EMAIL_AUTH_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  EMAIL_AUTH_SECRET: z.string().optional(),
  EMAIL_AUTH_FROM: z.string().optional(),
  EMAIL_AUTH_TRANSPORT: z.enum(["resend", "smtp"]).default("resend"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.string().optional(),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  TRUSTED_PROXY_CIDRS: z.string().optional().transform(parseTrustedProxyCidrs),
  // Legacy setting name; it now bounds the permanent registration ledger.
  AUTO_TRIAL_DAILY_IP_LIMIT: z.coerce.number().int().min(1).max(2).default(2),
  FFMPEG_BINARY: z.string().trim().min(1).optional(),
  FFPROBE_BINARY: z.string().trim().min(1).optional(),
  VOD_PLAYBACK_TTL_SECONDS: z.coerce.number().int().positive().optional().default(900),
  VOD_PLAYBACK_TEMP_DIR: z.string().trim().min(1).optional(),
  VOD_TRANSCODE_MAX_CONCURRENT: z.coerce.number().int().positive().optional().default(2),
  APP_UPDATE_MANIFEST_URL: z.string().url().optional(),
  APP_UPDATE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional().default(300),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
  PUBLIC_MEDIA_GATEWAY_URL: z.string().url().default("https://media.flixify.vip"),
  PRIVATE_CDN_DIRECT_USER_IDS: z.string().optional().default(""),
  PRIVATE_CDN_DIRECT_HOSTS: z.string().optional().default("edge.flixify.vip"),
  BROWSER_DIRECT_PROVIDER_USER_IDS: z.string().optional().default(""),
  BROWSER_DIRECT_PROVIDER_LINE_USERNAME: z.string().optional().default(""),
  BROWSER_DIRECT_PROVIDER_MODE: z.enum(["off", "canary", "percentage", "all"]).optional().default("off"),
  BROWSER_DIRECT_PROVIDER_PERCENT: z.coerce.number().int().min(0).max(100).optional().default(0),
  BROWSER_DIRECT_PROVIDER_SOURCE_HOSTS: z.string().optional().default(""),
  BROWSER_DIRECT_PROVIDER_HLS_ENABLED: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  REDIS_URL: z.string().url().optional(),
  ADULT_MOVIES_ENABLED: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  ADULT_MOVIES_CANARY_USER_IDS: z.string().optional().default(""),
  ADULT_MOVIES_CATEGORY_IDS: z.string().regex(/^(?:$|[1-9]\d{0,14}(?:,[1-9]\d{0,14})*)$/).optional().default(""),
  XM_RESELLER_API_URL: z.string().url().optional(),
  XM_RESELLER_API_KEY: z.string().min(1).optional(),
  STRIPE_CHECKOUT_ENABLED: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  STRIPE_MODE: z.enum(["test", "live"]).optional().default("test"),
  STRIPE_TEST_ALLOWED_USER_IDS: z.string().optional().default(""),
  STRIPE_TEST_SECRET_KEY: z.string().startsWith("sk_test_").optional(),
  STRIPE_LIVE_SECRET_KEY: z.string().startsWith("sk_live_").optional(),
  STRIPE_TEST_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_LIVE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_TEST_PRICE_1_MONTH: z.string().startsWith("price_").optional(),
  STRIPE_TEST_PRICE_3_MONTHS: z.string().startsWith("price_").optional(),
  STRIPE_TEST_PRICE_6_MONTHS: z.string().startsWith("price_").optional(),
  STRIPE_TEST_PRICE_12_MONTHS: z.string().startsWith("price_").optional(),
  STRIPE_LIVE_PRICE_1_MONTH: z.string().startsWith("price_").optional(),
  STRIPE_LIVE_PRICE_3_MONTHS: z.string().startsWith("price_").optional(),
  STRIPE_LIVE_PRICE_6_MONTHS: z.string().startsWith("price_").optional(),
  STRIPE_LIVE_PRICE_12_MONTHS: z.string().startsWith("price_").optional(),
  CACHE_ENABLED: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  PUBLIC_SUPPORT_WHATSAPP: z.string().url().default("https://wa.me/900000000000"),
  PUBLIC_SUPPORT_TELEGRAM: z.string().url().default("https://t.me/yourchannel")
});

const parsed = envSchema.parse(process.env);
validatePhoneAuthConfiguration(parsed);

function isExecutableFfmpeg(binary: string) {
  if (!binary) {
    return false;
  }

  try {
    const result = spawnSync(binary, ["-version"], {
      stdio: "ignore"
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveFfmpegBinary(explicitBinary: string | undefined) {
  const candidates = [explicitBinary?.trim(), "ffmpeg", ffmpegStatic ?? undefined]
    .filter((value): value is string => Boolean(value && value.length > 0));
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    if (isExecutableFfmpeg(candidate)) {
      return candidate;
    }
  }

  return uniqueCandidates[0] ?? "ffmpeg";
}

function deriveFfprobeCandidate(ffmpegBinary: string) {
  if (ffmpegBinary.endsWith("ffmpeg.exe")) {
    return `${ffmpegBinary.slice(0, -10)}ffprobe.exe`;
  }
  if (ffmpegBinary.endsWith("ffmpeg")) {
    return `${ffmpegBinary.slice(0, -6)}ffprobe`;
  }
  return undefined;
}

function resolveFfprobeBinary(explicitBinary: string | undefined, ffmpegBinary: string) {
  const candidates = [explicitBinary?.trim(), deriveFfprobeCandidate(ffmpegBinary), "ffprobe"].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    if (isExecutableFfmpeg(candidate)) {
      return candidate;
    }
  }

  return uniqueCandidates[0] ?? "ffprobe";
}

const resolvedFfmpegBinary = resolveFfmpegBinary(parsed.FFMPEG_BINARY);
const resolvedFfprobeBinary = resolveFfprobeBinary(parsed.FFPROBE_BINARY, resolvedFfmpegBinary);

export const env = {
  ...parsed,
  emailAuth: resolveEmailAuthConfiguration(parsed),
  FFMPEG_BINARY: resolvedFfmpegBinary,
  FFPROBE_BINARY: resolvedFfprobeBinary,
  adminEmails: parsed.ADMIN_EMAILS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
};
