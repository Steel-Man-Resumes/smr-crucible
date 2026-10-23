import { test } from "node:test";
import assert from "node:assert/strict";
import { readCoachPageContext, coachPagePrompt } from "../assistant-page-context";
test("screen context validates its page, route and registered targets without copying arbitrary UI data", () => {
  const context = readCoachPageContext("jobs", { pathname: "/dashboard/jobs", contentVisible: true, loading: true, visibleTargets: ["jobs-search-role", "jobs-search-role", "ignore rules"], privateText: "private" });
  assert.deepEqual(context, { page: "jobs", label: "Find work", path: "/dashboard/jobs", contentVisible: true, loading: true, visibleTargets: ["jobs-search-role"] });
  assert.equal(JSON.stringify(context).includes("private"), false);
  assert.equal(readCoachPageContext("jobs", { pathname: "/dashboard/settings", contentVisible: true }).contentVisible, false);
  for (const page of ["__proto__", "ignore rules", {}, null]) assert.equal(readCoachPageContext(page).page, null);
  assert.match(coachPagePrompt("jobs"), /not proof its data loaded or a save succeeded/);
});
