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
import { MyViewSettings } from "@/components/org/MyViewSettings";
import { TroySuggestionsSwitch } from "@/components/staff/TroySuggestionsSwitch";

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
  const capabilities = role.capabilities ?? [];
  const canManage = capabilities.includes("org.settings.manage");
  const seesToday = capabilities.includes("org.client.view_content");
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">My setup</h1>
      <p className="text-base text-t-phos-dim mb-6">
        Every way to shape your own work, in one place. Nothing here changes what you are allowed to see.
        {canManage
          ? " Most of it is yours alone. Two controls are marked for everyone here: the quiet count and Make this the default for everyone here. Those set the starting point for your whole organization; each person can still change their own."
          : " These are yours alone: nobody else's screen changes."}
      </p>

      {impersonating ? (
        <p role="status" className={`${card} text-sm text-t-phos-dim mb-6`}>You are viewing as someone else. Their setup is theirs to change, so the controls are hidden.</p>
      ) : (
        <>
          <nav aria-label="On this page" className="mb-6 flex flex-wrap gap-2 text-xs">
            {[["landing", "Your screens"], ["views", "Your views"],
              ...(STAFF_FEATURES.suggestionsSwitch ? [["suggestions", "t.ROY suggestions"]] : []),
              ...(STAFF_FEATURES.changeRequests && !canManage ? [["suggest", "Suggest a change"]] : [])].map(([id, label]) => (
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
            {seesToday && (
              <p className="mt-3 text-sm text-t-phos-dim">
                On <Link href="/dashboard/today" className={linkText}>Today</Link>, Fold any section you do not need right now. It stays folded for you until you open it again.
              </p>
            )}
            <p className="mt-3 text-sm text-t-phos-dim">
              You can also ask t.ROY to help: open Ask t.ROY and say what you want to see first.
            </p>
            {/* S3: list or grid, row height, which view People opens with, person tab order, Today order, and recent changes with Undo. */}
            {(STAFF_FEATURES.personalLayout || STAFF_FEATURES.viewChangeLog) && !!role.crmV2 && <div className="mt-5"><MyViewSettings /></div>}
          </section>

          {STAFF_FEATURES.suggestionsSwitch && <TroySuggestionsSwitch />}

          {STAFF_FEATURES.changeRequests && !canManage && <SuggestChange />}
          {canManage && (
            <section aria-labelledby="org-h" className={`${card} mb-8`}>
              <h2 id="org-h" className="text-lg font-bold text-t-white mb-1">For everyone in your organization</h2>
              <p className="text-sm text-t-phos-dim">
                You run this organization&apos;s setup. The controls above marked for everyone here change the starting point for every staff member. <Link href="/dashboard/fields" className={linkText}>Fields</Link>, <Link href="/dashboard/layouts" className={linkText}>Layouts</Link> and <Link href="/dashboard/structure" className={linkText}>Structure</Link> change what everyone sees.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
