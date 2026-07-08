import { query } from "../src/db";

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  await query(
    `INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions)
     VALUES ($1, $2, 'client', 200, 10)
     ON CONFLICT (code) DO NOTHING`,
    ["MWOCREW", "My Way Out"]
  );

  const row = await query<{ id: string; code: string; tier: string; daily_limit: number; max_redemptions: number }>(
    `SELECT id, code, tier, daily_limit, max_redemptions FROM access_code WHERE code = 'MWOCREW'`
  );
  console.log("MWOCREW row:", row.rows[0]);
  process.exit(0);
})();
