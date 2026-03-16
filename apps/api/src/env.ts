import path from "node:path";
import { fileURLToPath } from "node:url";
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
  VOD_PLAYBACK_TTL_SECONDS: z.coerce.number().int().positive().optional().default(900),
  VOD_PLAYBACK_TEMP_DIR: z.string().trim().min(1).optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
  PUBLIC_SUPPORT_WHATSAPP: z.string().url().default("https://wa.me/900000000000"),
  PUBLIC_SUPPORT_TELEGRAM: z.string().url().default("https://t.me/yourchannel")
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  FFMPEG_BINARY: parsed.FFMPEG_BINARY?.trim() || ffmpegStatic || "ffmpeg",
  adminEmails: parsed.ADMIN_EMAILS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
};
