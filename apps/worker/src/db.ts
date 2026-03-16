import { Pool } from "pg";
import { env } from "./env.js";

const useSupabaseSsl = env.DATABASE_URL.includes("supabase.com");

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSupabaseSsl ? { rejectUnauthorized: false } : undefined
});
