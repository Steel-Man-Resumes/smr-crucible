"use client";

/**
 * <ListingContributeMenu> -- the small "I called them / Suggest a fix / I know
 * someone there" row for one directory listing (lane S6). Mount it on each
 * employer and resource listing a staff member sees (WIRING NEEDED). Opens
 * <ContributeForm> in place, prefilled with the listing.
 */
import { useState } from "react";
import { FLOW_LABELS, type ContributionFlow, type ContributionKind } from "@crucible/core/src/directoryContributionShared";
import { ContributeForm } from "./ContributeForm";

export function ListingContributeMenu({ kind, id, name, nudgeLine }: { kind: ContributionKind; id: string; name: string; nudgeLine?: string | null }) {
  const [flow, setFlow] = useState<ContributionFlow | null>(null);
  const flows: ContributionFlow[] = kind === "employer" ? ["called_today", "correction", "knows_someone"] : ["called_today", "correction"];
  if (flow) {
    return <ContributeForm initial={{ flow, targetKind: kind, targetId: id, name }} flows={flows} onDone={() => setTimeout(() => setFlow(null), 2500)} onCancel={() => setFlow(null)} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {nudgeLine && <span className="text-t-phos">{nudgeLine}</span>}
      {flows.map((f) => (
        <button key={f} type="button" onClick={() => setFlow(f)} className="t-focus min-h-[44px] px-2 text-t-amber-bright underline underline-offset-4">{FLOW_LABELS[f].button}</button>
      ))}
    </div>
  );
}
