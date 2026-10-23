import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsIn, resolvePageJob } from "../jobResolver";

const source = `WORK EXPERIENCE
Production Manager\tMarch 2019 - Present
Example Glassworks, Milwaukee, WI
Supervised production employees and assigned daily work
Handled hiring, training, and scheduling of employees
Crew Leader, Rigging and Heavy Labor\t2005 - 2015
Example Marine Yard, Chicago, IL
Inspected ropes, chains, and lifting equipment before use`;

test("Word title/date rows retain the employer on the following line", () => {
  const jobs = jobsIn(source, { own: true });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].employer, "Example Glassworks");
  assert.equal(jobs[0].place, "Milwaukee, WI");
  assert.equal(jobs[1].title, "Crew Leader, Rigging and Heavy Labor");
  assert.equal(jobs[1].employer, "Example Marine Yard");
  assert.equal(jobs[0].body[0], "Supervised production employees and assigned daily work");
  assert.equal(resolvePageJob("Production Manager | Example Glassworks | Milwaukee, WI | March 2019 - Present", source).kind, "one");
});

test("a duty below a dated role never becomes its employer", () => {
  const jobs = jobsIn("WORK EXPERIENCE\nWarehouse Worker 2019 - 2022\nLoaded trucks and counted stock", { own: true });
  assert.equal(jobs[0].employer, "");
  assert.deepEqual(jobs[0].body, ["Loaded trucks and counted stock"]);
});

test("pipe-delimited titles preserve commas and match the uploaded title", () => {
  const header = "Crew Leader, Rigging and Heavy Labor | Example Marine Yard | Chicago, IL | 2005 - 2015";
  const jobs = jobsIn("WORK EXPERIENCE\n" + header + "\n- Inspected ropes.");
  assert.equal(jobs[0].title, "Crew Leader, Rigging and Heavy Labor");
  assert.equal(jobs[0].employer, "Example Marine Yard");
  assert.equal(resolvePageJob(header, source).kind, "one");
});
