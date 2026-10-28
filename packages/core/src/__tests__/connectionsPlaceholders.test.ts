import { test } from "node:test";
import assert from "node:assert/strict";
import { CONNECTION_APPS_SQL, CONNECTION_RESUMES_SQL, CONNECTION_RESUME_SHARED_SQL, SHARED_OPEN_LOG_SQL, CONNECTION_CANDIDATES_SQL } from "../orgClientView";

// Real Postgres refuses a bound parameter the statement never references
// ("could not determine data type of parameter $3"); the in-memory test
// database accepts it. Each statement must use every placeholder it is given.
function uses(sql: string, n: number) {
  for (let i = 1; i <= n; i++) assert.match(sql, new RegExp(`\\$${i}(?!\\d)`), `missing $${i}`);
  assert.doesNotMatch(sql, new RegExp(`\\$${n + 1}(?!\\d)`), `uses a placeholder beyond $${n}`);
}

test("connections reads use exactly the placeholders they are bound with", () => {
  uses(CONNECTION_APPS_SQL, 5);
  uses(CONNECTION_RESUMES_SQL, 5);
  uses(CONNECTION_RESUME_SHARED_SQL, 5);
  uses(SHARED_OPEN_LOG_SQL, 7);
  uses(CONNECTION_CANDIDATES_SQL, 4);
});
