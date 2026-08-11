// List every FK that references users(id) or "user"(id) and its ON DELETE rule.
// A non-CASCADE, non-manually-cleared FK would make account deletion FK-error.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1];
const { query } = await import('../packages/core/dist/index.js');

const rows = await query(`
  SELECT
    tc.table_name       AS child_table,
    kcu.column_name     AS child_col,
    ccu.table_name      AS parent_table,
    rc.delete_rule      AS on_delete
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name IN ('users','user')
    AND ccu.column_name = 'id'
  ORDER BY rc.delete_rule, tc.table_name`, []);

const bad = [];
for (const r of rows) {
  const flag = r.on_delete === 'CASCADE' ? 'ok  ' : 'CHECK';
  if (r.on_delete !== 'CASCADE') bad.push(`${r.child_table}.${r.child_col} -> ${r.parent_table} (${r.on_delete})`);
  console.log(`${flag} ${r.child_table}.${r.child_col} -> ${r.parent_table}  ON DELETE ${r.on_delete}`);
}
console.log(`\n${rows.length} FKs to users/user; ${bad.length} NON-CASCADE (must be manually cleared before deleting the users row):`);
for (const b of bad) console.log('  ' + b);
