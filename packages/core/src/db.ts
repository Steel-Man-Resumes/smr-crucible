import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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

/* ------------------------------------------------------- scoped access -- */

/**
 * The org this request is acting for. Only an authorization resolver mints one.
 *
 * It is a type rather than a bare string so a raw org id cannot be passed by
 * accident: to get one of these, something has to have established membership.
 */
export interface OrgScope {
  readonly orgId: string;
  readonly userId: string;
  readonly role: "owner" | "org_admin" | "staff";
}

/**
 * Run statements with the organization scope set on the connection, so the
 * DATABASE can enforce the boundary rather than trusting each query to
 * remember a WHERE clause.
 *
 * HOW IT WORKS. The Neon HTTP driver submits a statement array as one
 * transaction, so `set_config(..., true)` -- transaction-local -- is visible to
 * every statement after it and gone the moment the request ends. Row-level
 * security policies read those settings.
 *
 * THE CONSTRAINT THAT SHAPES EVERY CALL SITE: `build` must be SYNCHRONOUS. The
 * whole list ships in a single HTTP request, so there is nothing to await
 * against midway. Build the statements, return them, read the results.
 *
 * WHY THE SCOPE IS NEVER TAKEN FROM A REQUEST. The GUCs are set server-side
 * from an OrgScope that only the authorization resolver can produce. A caller
 * cannot nominate which organization they are acting as; membership decides.
 */
/**
 * Membership resolution, which cannot be org-scoped because it is what
 * DISCOVERS the org. Sets only the user id, which the policy honours for
 * reading your own row and never for writing one.
 */
export async function runAsUser<T = unknown[]>(
  userId: string,
  build: (sql: NeonQueryFunction<false, false>) => unknown[]
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = neon(url);
  const setup = [client`SELECT set_config('app.user_id', ${userId}, true)`];
  const results = await client.transaction([...setup, ...build(client)] as never);
  return (results as unknown[]).slice(setup.length) as T;
}

/**
 * query(), run as a specific user so row-level policies that permit somebody
 * to read THEIR OWN rows will pass.
 *
 * A drop-in for `query()` with the user id in front, deliberately: the friction
 * of converting a call site is what leaves it unconverted, and an unconverted
 * read against a protected table now returns an empty result rather than an
 * error. Silent emptiness is the failure mode to design against.
 */
export async function queryAsUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const out = await runAsUser<unknown[][]>(userId, (c) => [
    (c as unknown as (s: string, p?: unknown[]) => unknown)(sql, params),
  ]);
  return (out[0] ?? []) as T[];
}

/** getOne(), as a specific user. */
export async function getOneAsUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await queryAsUser<T>(userId, sql, params);
  return rows[0] ?? null;
}

export async function runScoped<T = unknown[]>(
  scope: OrgScope,
  build: (sql: NeonQueryFunction<false, false>) => unknown[]
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = neon(url);

  const setup = [
    client`SELECT set_config('app.org_id', ${scope.orgId}, true)`,
    client`SELECT set_config('app.user_id', ${scope.userId}, true)`,
    client`SELECT set_config('app.org_role', ${scope.role}, true)`,
  ];
  const statements = build(client);
  const results = await client.transaction([...setup, ...statements] as never);
  // Drop the three setup row-sets; hand back only what the caller asked for.
  return (results as unknown[]).slice(setup.length) as T;
}
