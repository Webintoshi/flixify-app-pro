import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import ffmpegStatic from "ffmpeg-static";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config();
config({
  path: path.resolve(__dirname, "../../../.env")
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_JWT_SECRET: z.string().min(32),
  APP_DEMO_MODE: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_EMAILS: z.string().min(3),
  API_PORT: z.coerce.number().int().positive().default(4000),
  FFMPEG_BINARY: z.string().trim().min(1).optional(),
  FFPROBE_BINARY: z.string().trim().min(1).optional(),
  VOD_PLAYBACK_TTL_SECONDS: z.coerce.number().int().positive().optional().default(900),
  VOD_PLAYBACK_TEMP_DIR: z.string().trim().min(1).optional(),
  VOD_TRANSCODE_MAX_CONCURRENT: z.coerce.number().int().positive().optional().default(2),
  APP_UPDATE_MANIFEST_URL: z.string().url().optional(),
  APP_UPDATE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional().default(300),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
  PUBLIC_SUPPORT_WHATSAPP: z.string().url().default("https://wa.me/900000000000"),
  PUBLIC_SUPPORT_TELEGRAM: z.string().url().default("https://t.me/yourchannel")
});

const parsed = envSchema.parse(process.env);

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
  FFMPEG_BINARY: resolvedFfmpegBinary,
  FFPROBE_BINARY: resolvedFfprobeBinary,
  adminEmails: parsed.ADMIN_EMAILS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
};
