import { test } from "node:test";
import assert from "node:assert/strict";
import { broadenJobSearch } from "../job-search-broaden";
import { assessJobSearch, readJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
test("explicit broader search removes optional requirements while preserving exclusions and the original choices", () => {
  const original = readJobSearchFilters({ radiusMiles: { value: 5 }, pay: { minimum: 40 }, includeUnknown: false, arrangements: { value: ["remote"] }, excludedEmployers: ["Avoided employer"], excludedKeywords: ["unwanted"] });
  const next = broadenJobSearch(original);
  assert.equal(next.radiusMiles.value, null); assert.equal(next.postedWithinDays.value, null); assert.equal(next.pay.minimum, null); assert.equal(next.includeUnknown, true);
  assert.equal(original.radiusMiles.value, 5); assert.equal(original.includeUnknown, false);
  assert.equal(assessJobSearch({ title: "Role", company: "Unknown employer" }, next).included, true);
  assert.equal(assessJobSearch({ title: "Role", company: "Avoided employer" }, next).included, false);
  assert.equal(assessJobSearch({ title: "unwanted role", company: "Other" }, next).included, false);
});
