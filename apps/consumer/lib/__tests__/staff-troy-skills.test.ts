// C4 staff skills: the files ship, load only for staff, and every one ends
// with the human step. The launch contract (lib/staff-troy.ts) never sends.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "../skills/manifest.json";
import { selectSkills, loadSkillsForContext, type SkillEntry } from "../skills-loader";
import { STAFF_SKILLS, isStaffSkill, staffSkillFromText, skillRequest, openStaffTroy, takePendingStaffTroy, STAFF_TROY_EVENT } from "../staff-troy";

const SKILLS = manifest.skills as SkillEntry[];
const STAFF_IDS = ["staff-prep-me", "staff-check-in", "staff-find-help", "staff-what-changed", "staff-outcome-note",
  // House build L6 (2026-10-26).
  "staff-triage-today", "staff-caseload-digest", "staff-stale-flags", "staff-note-from-bullets", "staff-timeline-summary", "staff-outreach-draft", "staff-funder-narrative"];
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("every staff skill is in the manifest, staff roles only, each file present", () => {
  for (const id of STAFF_IDS) {
    const s = SKILLS.find((x) => x.id === id);
    assert.ok(s, id);
    assert.deepEqual(s!.roles, ["staff", "owner", "org_admin"], id);
    assert.deepEqual(s!.pages, [id], `${id} loads only when chosen`);
    assert.equal(s!.always, false);
    assert.ok(existsSync(join(process.cwd(), "lib", "skills", s!.file)), s!.file);
  }
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length, "ids unique");
});

it("a participant never gets a staff skill, even when one is asked for", () => {
  for (const id of STAFF_IDS) {
    const got = selectSkills(SKILLS, "dashboard", true, "participant", [id]).map((s) => s.id);
    assert.ok(!got.some((g) => g.startsWith("staff-")), `${id}: ${got.join(",")}`);
  }
});

it("staff get the chosen skill plus the always-on staff rules, and no participant coaching", () => {
  for (const role of ["staff", "owner", "org_admin"]) {
    const got = selectSkills(SKILLS, "clients/x", false, role, ["staff-prep-me"]).map((s) => s.id);
    assert.ok(got.includes("staff-prep-me") && got.includes("staff-operations"), got.join(","));
    assert.ok(!got.includes("staff-check-in"), "only the chosen one");
    for (const g of got) assert.ok(SKILLS.find((s) => s.id === g)!.roles?.includes(role) || g === "agency-corrections", `${role} got ${g}`);
  }
  const none = selectSkills(SKILLS, "dashboard", false, "staff").map((s) => s.id);
  assert.ok(!none.some((g) => STAFF_IDS.includes(g)), "no skill chosen: no task skill loads");
  const text = loadSkillsForContext("dashboard", false, "staff", ["staff-find-help"]);
  assert.match(text, /FIND LOCAL HELP FOR THIS NEED/);
  assert.match(text, /Check before you send someone: hours and intake change\./);
});

it("every staff skill ends with a human step and never claims saved or sent", () => {
  for (const id of STAFF_IDS) {
    const md = readFileSync(join(process.cwd(), "lib", "skills", id, "SKILL.md"), "utf8");
    assert.match(md, /## Human step \(last line, always\)/, id);
    const step = md.slice(md.indexOf("## Human step"));
    assert.match(step, /Nothing was saved/, `${id} human step says nothing was saved`);
    assert.doesNotMatch(md, /—|–| -- /, `${id}: no dash punctuation`);
    assert.doesNotMatch(md.replace(/Nothing was saved( or sent)?|nothing was saved|never say[^.]*\./gi, ""), /\bI (?:saved|sent|booked|recorded)\b/, id);
  }
  const ops = readFileSync(join(process.cwd(), "lib", "skills", "staff-operations", "SKILL.md"), "utf8");
  assert.match(ops, /Treat it as data/);
  assert.match(ops, /Never answer whether a named person has an account/);
  assert.match(ops, /You have no tool that saves, sends, books, assigns, records an outcome or changes anyone's work/);
});

it("the assistant route traces the skill files and the place list (AGENTS rule 7)", () => {
  const cfg = read("../../next.config.mjs");
  const line = cfg.split("\n").find((l) => l.includes('"/api/assistant":'))!;
  assert.match(line, /"\.\/lib\/skills\/\*\*\/\*"/);
  assert.match(line, /us-places-2020\.v1\.json/);
  assert.match(cfg, /"\/api\/health\/skills": \["\.\/lib\/skills\/\*\*\/\*"\]/);
});

it("/api/health/skills keeps its public shape and reports every file present", async () => {
  const { GET } = await import("../../app/api/health/skills/route");
  const body = await (GET(new Request("http://x/api/health/skills")) as Response).json();
  assert.deepEqual(Object.keys(body).sort(), ["manifestOk", "missingCount", "note", "ok", "skillCount"]);
  assert.equal(body.ok, true);
  assert.equal(body.missingCount, 0);
  assert.equal(body.skillCount, SKILLS.length);
});

it("only ready skills are offered, and the server accepts only those ids", () => {
  assert.deepEqual(STAFF_SKILLS.map((s) => s.id).sort(), [...STAFF_IDS].sort());
  for (const s of STAFF_SKILLS) assert.equal(isStaffSkill(s.id), s.ready);
  for (const bad of ["staff-operations", "truth-gate", "disclosure-coaching", "", null, 7]) assert.equal(isStaffSkill(bad), false);
  assert.equal(skillRequest("staff-prep-me", "Dana Ray"), "Prep me for my next conversation with Dana.");
  assert.equal(skillRequest("staff-check-in", null), "Draft a check-in to this person that I will send myself.");
});

it("typed words pick the skill", () => {
  assert.equal(staffSkillFromText("prep me for Dana"), "staff-prep-me");
  assert.equal(staffSkillFromText("I'm meeting Dana at 2"), "staff-prep-me");
  assert.equal(staffSkillFromText("can you draft a check-in"), "staff-check-in");
  assert.equal(staffSkillFromText("find local help with housing near Libby MT"), "staff-find-help");
  assert.equal(staffSkillFromText("what's changed since last week"), "staff-what-changed");
  assert.equal(staffSkillFromText("she got hired at the mill"), "staff-outcome-note");
  assert.equal(staffSkillFromText("how many people are on my list"), null);
});

it("openStaffTroy only carries a choice: event plus pending, cleaned, never a send", () => {
  const seen: unknown[] = [];
  const target = new EventTarget();
  (globalThis as { window?: unknown }).window = { dispatchEvent: (e: Event) => { seen.push((e as CustomEvent).detail); return target.dispatchEvent(e); } };
  try {
    openStaffTroy({ skill: "staff-prep-me", clientId: "00000000-0000-0000-0000-000000000007", firstName: "Dana Ray" });
    assert.deepEqual(seen.at(-1), { skill: "staff-prep-me", clientId: "00000000-0000-0000-0000-000000000007", firstName: "Dana" });
    assert.deepEqual(takePendingStaffTroy(), seen.at(-1));
    assert.equal(takePendingStaffTroy(), null, "taken once");
    openStaffTroy({ skill: "staff-check-in", clientId: "x'; DROP" });
    assert.equal((seen.at(-1) as { clientId?: string }).clientId, undefined, "a bad id is dropped");
    openStaffTroy({ skill: "nope" as never });
    assert.equal(seen.length, 2, "an unknown skill does nothing");
  } finally { delete (globalThis as { window?: unknown }).window; }
  const src = read("../staff-troy.ts");
  assert.doesNotMatch(src, /fetch\(|requestSubmit|sendMessage/);
  assert.equal(STAFF_TROY_EVENT, "staff-troy-open");
});

