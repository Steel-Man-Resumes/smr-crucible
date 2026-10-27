"use client";
/**
 * The top of Help & Feedback for organization staff (staff pass 2026-10-27,
 * lane S2; walk finding T03 row 18). Staff were sent to the participant tour,
 * the settings lesson and the orientation check. Here instead: replay the
 * staff tour, what t.ROY can do for you (the real staff skill list), how to
 * shape your own work, how to ask for a change that affects everyone, and how
 * the people you serve are protected. The support form below stays the same.
 *
 * Every link is a real page; "Suggest a change" shows only once the change
 * request lane is merged (lib/staff-features.ts), never as a dead button.
 */
import Link from "next/link";
import { STAFF_SKILLS, skillRequest, type StaffSkill } from "@/lib/staff-troy";
import { STAFF_FEATURES, type StaffFeatures } from "@/lib/staff-features";
import { STAFF_TOUR_HOME, STAFF_TOUR_PARAM } from "@/lib/tour/staff-tour";

export const STAFF_TOUR_REPLAY_HREF = `${STAFF_TOUR_HOME}?tour=${STAFF_TOUR_PARAM}`;

/** The skills staff can ask for, split the way the t.ROY panel shows them. Pure, exported for tests. */
export function staffSkillGroups(skills: readonly StaffSkill[] = STAFF_SKILLS): { person: StaffSkill[]; caseload: StaffSkill[] } {
  const ready = skills.filter((s) => s.ready);
  return {
    person: ready.filter((s) => s.scope === "person" || s.scope === "both"),
    caseload: ready.filter((s) => s.scope === "caseload"),
  };
}

/** What to type, written the way a case manager would ask. The blank "is: " endings become a plain prompt. */
export function skillExample(skill: StaffSkill): string {
  return skillRequest(skill.id, null).replace(/:\s*$/, ": ...").replace("this person's", "their").replace("this person", "them");
}

const linkBtn = "t-focus inline-flex min-h-touch items-center border border-t-line px-4 py-2 text-sm font-semibold text-t-white hover:border-t-amber";

export function StaffHelp({ tourAllowed, features = STAFF_FEATURES }: { tourAllowed: boolean; features?: StaffFeatures }) {
  const { person, caseload } = staffSkillGroups();
  return (
    <div className="mb-8 space-y-6" data-testid="staff-help">
      <div className="flex flex-wrap gap-3">
        {tourAllowed && <Link href={STAFF_TOUR_REPLAY_HREF} className={linkBtn}>Replay the staff tour</Link>}
        <Link href="/dashboard/my-setup" className={linkBtn}>My setup</Link>
        <Link href="/dashboard/org-security" className={linkBtn}>How we protect the people you serve</Link>
      </div>

      <section aria-labelledby="staff-help-troy" className="bg-t-panel border border-t-line p-5">
        <h2 id="staff-help-troy" className="text-lg font-bold text-t-white">What t.ROY can do for you</h2>
        <p className="mt-1 text-sm text-t-phos-dim">
          Open Ask t.ROY at the bottom of the sidebar, or use the buttons on Today and on a person&apos;s page. He reads only what you can already see, and he drafts. Nothing is saved or sent until you do it.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <SkillList title="About one person" skills={person} />
          <SkillList title="Across your whole list" skills={caseload} />
        </div>
      </section>

      <section aria-labelledby="staff-help-change" className="bg-t-panel border border-t-line p-5">
        <h2 id="staff-help-change" className="text-lg font-bold text-t-white">Shape your work, or ask for a change</h2>
        <ul className="mt-2 space-y-2 text-sm text-t-phos-dim">
          <li><span className="text-t-white font-semibold">Just for you.</span> Your views, columns, what Today shows and where you land are yours to change. They are all on <Link href="/dashboard/my-setup" className="text-t-amber-bright underline underline-offset-4">My setup</Link>.</li>
          <li><span className="text-t-white font-semibold">For everyone.</span> Fields, layouts, programs and sharing rules are set by the people who run your organization here.{" "}
            {features.changeRequests
              ? <>Send them a suggestion from <Link href="/dashboard/my-setup#suggest" className="text-t-amber-bright underline underline-offset-4">My setup</Link>, and their answer comes back to you.</>
              : <>Tell them what would help; a short note about what you need and why goes a long way.</>}
          </li>
        </ul>
      </section>
    </div>
  );
}

function SkillList({ title, skills }: { title: string; skills: readonly StaffSkill[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright">{title}</h3>
      <ul className="mt-2 space-y-2">
        {skills.map((s) => (
          <li key={s.id} className="text-sm">
            <span className="block font-semibold text-t-white">{s.label}</span>
            <span className="block text-t-phos-dim">&ldquo;{skillExample(s)}&rdquo;</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
