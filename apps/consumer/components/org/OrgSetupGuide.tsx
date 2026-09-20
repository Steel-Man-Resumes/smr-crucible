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

interface Line { key: string; attention: boolean; text: string; href: string; action: string }

export function OrgSetupGuide() {
  const [lines, setLines] = useState<Line[] | null>(null);
  useEffect(() => {
    (async () => {
      const [a, i] = await Promise.all([
        fetch("/api/org/access").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/org/insights").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const out: Line[] = [];
      const members: { role: string; pending: boolean; access: { override: string | null }[] }[] = a?.members ?? [];
      const staff = members.filter((m) => m.role !== "owner");
      const ins = i?.insights;
      if (a) {
        const pending = staff.filter((m) => m.pending).length;
        if (staff.length === 0) out.push({ key: "nostaff", attention: true, text: "You are the only one here. Add your case managers and each gets their own caseload.", href: "/dashboard/team", action: "Add your team" });
        else if (pending > 0) out.push({ key: "pending", attention: true, text: `${pending} ${pending === 1 ? "person on your team has" : "people on your team have"} been invited and not signed in yet.`, href: "/dashboard/team", action: "See who" });
        out.push({ key: "access", attention: false, text: "Access is set per person, not just per role: one case manager can see everyone, another can be kept to notes only. Every change is recorded.", href: "/dashboard/team", action: "Team & access" });
      }
      if (ins) {
        if (ins.unassigned > 0) out.push({ key: "unassigned", attention: true, text: `${ins.unassigned} ${ins.unassigned === 1 ? "participant is" : "participants are"} not assigned to anyone, so nobody sees them on a caseload.`, href: "/dashboard", action: "Assign them" });
        if (ins.people.notSharing > 0) out.push({ key: "notsharing", attention: false, text: `${ins.people.notSharing} ${ins.people.notSharing === 1 ? "person has" : "people have"} joined and not turned on progress sharing. That is their choice; it is worth a conversation about what it is for.`, href: "/dashboard/insights", action: "See the numbers" });
        if (ins.activity.quiet > 0) out.push({ key: "quiet", attention: true, text: `${ins.activity.quiet} ${ins.activity.quiet === 1 ? "person has" : "people have"} been quiet for ${ins.quietAfterDays} days or more.`, href: "/dashboard", action: "Open the caseload" });
        out.push({ key: "insights", attention: false, text: "Insights shows your funnel, outcomes and each staff member's load, counted only over what participants agreed you can see, so you can put it in front of a funder.", href: "/dashboard/insights", action: "Insights" });
      }
      out.push({ key: "defaults", attention: false, text: "Arrange the caseload the way you want your team to see it, then make it the default for everyone. Each person can still change their own.", href: "#workflow", action: "My workflow" });
      out.push({ key: "security", attention: false, text: "There is a plain-language security statement written for the person at your organization who has to answer for this.", href: "/dashboard/org-security", action: "Security & privacy" });
      setLines(out);
    })();
  }, []);
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((x, y) => Number(y.attention) - Number(x.attention));
  return (
    <section className="mb-8" aria-labelledby="org-setup-heading">
      <h2 id="org-setup-heading" className="text-lg font-bold text-t-white mb-1">Your organization</h2>
      <p className="text-sm text-t-phos-dim mb-4">What needs you, and what this can do that you may not have found yet.</p>
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
