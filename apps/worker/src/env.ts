import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config();
config({
  path: path.resolve(__dirname, "../../../.env")
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_DEMO_MODE: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000)
});

export const env = envSchema.parse(process.env);
