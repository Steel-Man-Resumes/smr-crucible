/**
 * Read the checked resource directory (migration 082, resource_app_v).
 * See resourceDirectoryShared.ts for what the view holds and why.
 */
import { query } from "./db";
import { resourceAppSql, type ResourceAppRow } from "./resourceDirectoryShared";

export * from "./resourceDirectoryShared";

export async function readResourceDirectory(opts: { state: string | null; areas: readonly string[] }): Promise<ResourceAppRow[]> {
  const { sql, params } = resourceAppSql(opts);
  if (!(params[0] as string[]).length) return [];
  return query<ResourceAppRow>(sql, params);
}
