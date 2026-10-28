"use client";

/**
 * <OrgSetupGuide> -- for the owner and admins: what this system can do for an
 * organization, stated as what is true for THEIRS right now.
 *
 * Not a tour and not a checklist to complete. Each line is either a fact that
 * needs attention ("1 person on your team has never signed in") or a thing the
 * system does that a busy director may not have found, with the one link that
 * gets them there. Lines with nothing to say do not render.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { OrgSetupPrompt } from "@/components/org/OrgSetupPrompt";
import { useOrgTerms, type OrgWords } from "@/lib/use-org-terms";
import { pluralTerm } from "@crucible/core/src/orgStructureShared";

interface Line { key: string; attention: boolean; text: string; href: string; action: string }
interface AccessResp { members?: { role: string; pending: boolean; access: { override: string | null }[] }[] }
interface InsightsResp { insights?: { unassigned: number; people: { notSharing: number }; activity: { quiet: number }; quietAfterDays: number } }

/** The guide's lines, in the organization's words. Pure over the two responses. */
function guideLines(a: AccessResp | null, i: InsightsResp | null, t: OrgWords): Line[] {
  const out: Line[] = [];
  const members = a?.members ?? [];
  const staff = members.filter((m) => m.role !== "owner");
  const ins = i?.insights;
  if (a) {
    const pending = staff.filter((m) => m.pending).length;
    if (staff.length === 0) out.push({ key: "nostaff", attention: true, text: `You are the only one here. Add your ${pluralTerm(t.case_manager)} and each gets their own ${t.caseload}.`, href: "/dashboard/team", action: "Add your team" });
    else if (pending > 0) out.push({ key: "pending", attention: true, text: `${pending} ${pending === 1 ? "person on your team has" : "people on your team have"} been invited and not signed in yet.`, href: "/dashboard/team", action: "See who" });
    out.push({ key: "access", attention: false, text: `Access is set per person, not just per role: one ${t.case_manager} can see everyone, another can be kept to notes only. Every change is recorded.`, href: "/dashboard/team", action: "Team & access" });
    out.push({ key: "structure", attention: false, text: `Put your ${pluralTerm(t.program)}, ${pluralTerm(t.site)} and ${pluralTerm(t.team)} in one place, and each ${t.staff_member} in the groups they work in.`, href: "/dashboard/structure", action: "Structure" });
  }
  if (ins) {
    if (ins.unassigned > 0) out.push({ key: "unassigned", attention: true, text: `${ins.unassigned} ${ins.unassigned === 1 ? `${t.participant} is` : `${t.participants} are`} not assigned to anyone, so nobody sees them on a ${t.caseload}.`, href: "/dashboard/people", action: "Assign them" });
    if (ins.people.notSharing > 0) out.push({ key: "notsharing", attention: false, text: `${ins.people.notSharing} ${ins.people.notSharing === 1 ? "person has" : "people have"} joined and not turned on progress sharing. That is their choice; it is worth a conversation about what it is for.`, href: "/dashboard/insights", action: "See the numbers" });
    if (ins.activity.quiet > 0) out.push({ key: "quiet", attention: true, text: `${ins.activity.quiet} ${ins.activity.quiet === 1 ? "person has" : "people have"} been quiet for ${ins.quietAfterDays} days or more.`, href: "/dashboard/people", action: `Open the ${t.caseload}` });
    out.push({ key: "insights", attention: false, text: `Insights shows your funnel, outcomes and each ${t.staff_member}'s load, counted only over what ${t.participants} agreed you can see, so you can put it in front of a funder.`, href: "/dashboard/insights", action: "Insights" });
  }
  out.push({ key: "defaults", attention: false, text: `Arrange the ${t.caseload} the way you want your team to see it, then make it the default for everyone. Each person can still change their own.`, href: "/dashboard/my-setup#landing", action: "My setup" });
  out.push({ key: "security", attention: false, text: "There is a plain-language security statement written for the person at your organization who has to answer for this.", href: "/dashboard/org-security", action: "Security & privacy" });
  return out;
}

export function OrgSetupGuide() {
  const t = useOrgTerms();
  const [raw, setRaw] = useState<{ a: AccessResp | null; i: InsightsResp | null } | null>(null);
  useEffect(() => {
    (async () => {
      const [a, i] = await Promise.all([
        fetch("/api/org/access").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/org/insights").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setRaw({ a, i });
    })();
  }, []);
  // Built at render so the organization's own words show as soon as they load.
  const lines = raw ? guideLines(raw.a, raw.i, t) : null;
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((x, y) => Number(y.attention) - Number(x.attention));
  return (
    <section className="mb-8" aria-labelledby="org-setup-heading">
      <h2 id="org-setup-heading" className="text-lg font-bold text-t-white mb-1">Your organization</h2>
      <p className="text-sm text-t-phos-dim mb-4">What needs you, and what this can do that you may not have found yet.</p>
      <OrgSetupPrompt placement="settings" />
      <ul className="bg-t-panel border border-t-line divide-y divide-t-line">
        {sorted.map((l) => (
          <li key={l.key} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-t-phos flex-1 min-w-[16rem]">
              {l.attention && <span className="text-t-amber-bright font-semibold">Needs you: </span>}{l.text}
            </p>
            <Link href={l.href} className="t-focus text-xs font-semibold text-t-amber-bright underline underline-offset-4 hover:text-t-amber whitespace-nowrap">{l.action}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
