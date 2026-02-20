import { neon } from "@neondatabase/serverless";

function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = getClient();
  const rows = await client(sql, params);
  return rows as T[];
}

export async function getOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function insert<T = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const cols = keys.map((k) => `"${k}"`).join(", ");

  const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders.join(", ")}) RETURNING *`;
  const rows = await query<T>(sql, values);
  return rows[0];
}
