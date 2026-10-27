"use client";

/**
 * My setup (staff pass 2026-10-27, lane S2; walk finding T05: "How can she
 * optimize her own layout?"). Every way a staff member shapes their OWN work,
 * in one place: where they land and what Today shows (the My workflow
 * controls, moved here from Settings), their own views of People, folds on
 * Today, and, as the other lanes merge (lib/staff-features.ts), the t.ROY
 * suggestions switch, the rewards switch, notification choices and the list
 * of recent changes to their view. Nothing here changes what anyone else sees
 * or what this person is allowed to see.
 *
 * "Suggest a change to your organization" sends a plain note to the people
 * who run the organization (S4's route). It shows only once that route is
 * merged: never a dead button.
 */
import Link from "next/link";
import { useEffectiveRole } from "@/components/RoleProvider";
import { StaffWorkflowSettings } from "@/components/org/StaffWorkflowSettings";
import { STAFF_FEATURES } from "@/lib/staff-features";
import { SuggestChange } from "@/components/staff/SuggestChange";

const card = "bg-t-panel border border-t-line p-5";
const linkText = "text-t-amber-bright underline underline-offset-4 hover:text-t-amber";

export default function MySetupPage() {
  const role = useEffectiveRole();
  if (!role) return <p role="status" className="text-sm text-t-phos-dim">Loading your setup...</p>;
  if (!role.orgRole) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-2">My setup</h1>
        <p className="text-sm text-t-phos-dim">My setup is for people who work in an organization here. Your own choices are in <Link href="/dashboard/settings" className={linkText}>Settings</Link>.</p>
      </div>
    );
  }
  const impersonating = !!role.impersonating;
  const canManage = (role.capabilities ?? []).includes("org.settings.manage");
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">My setup</h1>
      <p className="text-base text-t-phos-dim mb-6">
        Every way to shape your own work, in one place. These are yours alone: nobody else&apos;s screen changes, and nothing here changes what you are allowed to see.
      </p>

      {impersonating ? (
        <p role="status" className={`${card} text-sm text-t-phos-dim mb-6`}>You are viewing as someone else. Their setup is theirs to change, so the controls are hidden.</p>
      ) : (
        <>
          <nav aria-label="On this page" className="mb-6 flex flex-wrap gap-2 text-xs">
            {[["landing", "Your screens"], ["views", "Your views"], ...(STAFF_FEATURES.changeRequests ? [["suggest", "Suggest a change"]] : [])].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="t-focus rounded-[4px] border border-t-line px-3 py-1.5 font-medium text-t-phos-dim hover:border-t-amber hover:text-t-white">{label}</a>
            ))}
          </nav>

          <div id="landing" className="scroll-mt-32">
            <StaffWorkflowSettings workspace={!!role.crmV2} />
          </div>

          <section id="views" aria-labelledby="views-h" className={`${card} mb-8 scroll-mt-32`}>
            <h2 id="views-h" className="text-lg font-bold text-t-white mb-1">Your views of People</h2>
            <p className="text-sm text-t-phos-dim">
              On <Link href="/dashboard/people" className={linkText}>People</Link>, use Columns, Filter, Sort and Group to see your list the way you work, then press Save view. It is saved under My views, for you only, and People opens on the last one you picked.
            </p>
            <p className="mt-3 text-sm text-t-phos-dim">
              On <Link href="/dashboard/today" className={linkText}>Today</Link>, Fold any section you do not need right now. It stays folded for you until you open it again.
            </p>
            <p className="mt-3 text-sm text-t-phos-dim">
              You can also ask t.ROY to help: open Ask t.ROY and say what you want to see first.
            </p>
          </section>

          {STAFF_FEATURES.changeRequests && !canManage && <SuggestChange />}
          {canManage && (
            <section aria-labelledby="org-h" className={`${card} mb-8`}>
              <h2 id="org-h" className="text-lg font-bold text-t-white mb-1">For everyone in your organization</h2>
              <p className="text-sm text-t-phos-dim">
                You run this organization&apos;s setup. <Link href="/dashboard/fields" className={linkText}>Fields</Link>, <Link href="/dashboard/layouts" className={linkText}>Layouts</Link> and <Link href="/dashboard/structure" className={linkText}>Structure</Link> change what everyone sees.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
