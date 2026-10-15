"use client";

/**
 * Settings, "Your tools": which premium tools are open and why, and for each
 * locked one, how to get it (lib/premium.ts). No price anywhere.
 */

import { PremiumLocked, PremiumUnavailable, usePremium } from "@/components/premium/PremiumGate";
import { PREMIUM_INCLUDED_LINE, SPONSORED_TOOL_IDS, PREMIUM_TOOL_LABELS, premiumAccessLine, toolIsOpen } from "@/lib/premium";

export function PremiumToolsSection() {
  const { status, loaded } = usePremium();
  if (!loaded || !status || !status.gate) return null;
  // Only the sponsored tools can be locked (lib/premium.ts, the split).
  const open = SPONSORED_TOOL_IDS.filter((t) => toolIsOpen(status, t));
  const locked = SPONSORED_TOOL_IDS.filter((t) => !toolIsOpen(status, t));
  return (
    <section id="premium" className="scroll-mt-32 mb-8" aria-labelledby="premium-heading" data-testid="premium-tools">
      <h2 id="premium-heading" className="text-lg font-bold text-t-white mb-1">Your tools</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        {PREMIUM_INCLUDED_LINE} You never pay for any of it.
      </p>
      {open.length > 0 && (
        <p className="mb-4 text-sm text-t-phos" data-testid="premium-open-list">
          Open for you: {open.map((t) => PREMIUM_TOOL_LABELS[t]).join(", ")}.
          {" "}{premiumAccessLine(status)}
        </p>
      )}
      <div className="space-y-4">
        {locked.map((t) =>
          status.unavailable ? (
            <PremiumUnavailable key={t} tool={t} compact />
          ) : (
            <PremiumLocked key={t} tool={t} status={status} compact />
          )
        )}
      </div>
    </section>
  );
}
