import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceBandSql, resourceStatePaging, RESOURCE_STATE_PAGE_SIZE, RESOURCE_STATE_PAGE_MAX, RESOURCE_APP_LEVEL_CAP } from '../resourceDirectoryShared';

// 2026-10-24: the state page read only the newest 50 rows per band and level, so Michigan showed 298 of 1,739 public
// services. A trusted server can now read the whole state in pages; everyone else keeps the capped slice.

test('state paging parses page and limit and refuses nonsense', () => {
  assert.equal(resourceStatePaging(null), null);
  assert.equal(resourceStatePaging(undefined), null);
  assert.equal(resourceStatePaging(''), null);
  assert.deepEqual(resourceStatePaging('0'), { page: 0, limit: RESOURCE_STATE_PAGE_SIZE });
  assert.deepEqual(resourceStatePaging('3', '50'), { page: 3, limit: 50 });
  assert.deepEqual(resourceStatePaging('2', '9999'), { page: 2, limit: RESOURCE_STATE_PAGE_SIZE });
  assert.deepEqual(resourceStatePaging('2', '0'), { page: 2, limit: RESOURCE_STATE_PAGE_SIZE });
  assert.deepEqual(resourceStatePaging('2', 'abc'), { page: 2, limit: RESOURCE_STATE_PAGE_SIZE });
  assert.deepEqual(resourceStatePaging(String(RESOURCE_STATE_PAGE_MAX)), { page: RESOURCE_STATE_PAGE_MAX, limit: RESOURCE_STATE_PAGE_SIZE });
  for (const bad of ['-1', '1.5', 'x', String(RESOURCE_STATE_PAGE_MAX + 1), "0; DROP TABLE"]) assert.equal(resourceStatePaging(bad), null, bad);
});

test('a paged whole-state read drops the cap, keeps the order, and binds limit and offset', () => {
  const q = resourceBandSql({ state: 'MI', areas: ['food', 'jobs'], wholeState: true, bands: ['A', 'B', 'C'], paging: { page: 2, limit: 200 } });
  assert.match(q.sql, /FROM resource_band_publication_v/);
  assert.match(q.sql, /\(geo_scope = 'national' OR state = \$2\)/);
  assert.match(q.sql, /band = ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(q.sql, /row_number|PARTITION BY|rn <=/);
  assert.match(q.sql, /ORDER BY r\.band, r\.lvl, r\.last_checked DESC, r\.org_name, r\.service_id\s+LIMIT \$4 OFFSET \$5/);
  assert.deepEqual(q.params, [['food', 'jobs'], 'MI', ['A', 'B', 'C'], 200, 400]);
  assert.doesNotMatch(q.sql, /'MI'|DROP/);
  // Same columns as the capped query, so the site reads both the same way.
  const capped = resourceBandSql({ state: 'MI', areas: ['food', 'jobs'], wholeState: true, bands: ['A', 'B', 'C'] });
  assert.equal(q.sql.split('FROM (')[0].trim(), capped.sql.split('FROM (')[0].trim());
  const used = new Set((q.sql.match(/\$\d+/g) || []).map((m) => Number(m.slice(1))));
  for (let i = 1; i <= q.params.length; i++) assert.ok(used.has(i), `$${i} bound but unused`);
});

test('without paging, or off the state scope, the capped query is unchanged', () => {
  const whole = resourceBandSql({ state: 'MI', areas: ['food'], wholeState: true, bands: ['A', 'B', 'C'] });
  assert.match(whole.sql, /PARTITION BY m\.band, m\.lvl/);
  assert.deepEqual(whole.params, [['food'], 'MI', ['A', 'B', 'C'], RESOURCE_APP_LEVEL_CAP]);
  assert.equal(RESOURCE_APP_LEVEL_CAP, 50);
  // A place read (not a whole-state read) ignores paging entirely.
  const place = resourceBandSql({ state: 'MT', areas: ['food'], countyKeys: ['lincoln'], bands: ['A'], paging: { page: 0, limit: 200 } });
  assert.match(place.sql, /PARTITION BY m\.band, m\.lvl/);
  assert.doesNotMatch(place.sql, /OFFSET/);
  assert.equal(place.params[place.params.length - 1], RESOURCE_APP_LEVEL_CAP);
});
