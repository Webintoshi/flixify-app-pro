import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env.js";

const useSupabaseSsl = env.DATABASE_URL.includes("supabase.com");

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSupabaseSsl ? { rejectUnauthorized: false } : undefined
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await handler(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
