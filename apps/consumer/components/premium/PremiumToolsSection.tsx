"use client";

/**
 * Settings, "Your tools": which premium tools are open and why, and for each
 * locked one, how to get it (lib/premium.ts). No price anywhere.
 */

import { PremiumLocked, usePremium } from "@/components/premium/PremiumGate";
import { PREMIUM_TOOL_IDS, PREMIUM_TOOL_LABELS, premiumAccessLine, toolIsOpen } from "@/lib/premium";

export function PremiumToolsSection() {
  const { status, loaded } = usePremium();
  if (!loaded || !status || !status.gate) return null;
  const open = PREMIUM_TOOL_IDS.filter((t) => toolIsOpen(status, t));
  const locked = PREMIUM_TOOL_IDS.filter((t) => !toolIsOpen(status, t));
  return (
    <section id="premium" className="scroll-mt-32 mb-8" aria-labelledby="premium-heading" data-testid="premium-tools">
      <h2 id="premium-heading" className="text-lg font-bold text-t-white mb-1">Your tools</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Local resources, interview coaching and one-click apply open through an organization that works with Steel Man Resumes, or SMR can open them for you. You never pay for them.
      </p>
      {open.length > 0 && (
        <p className="mb-4 text-sm text-t-phos" data-testid="premium-open-list">
          Open for you: {open.map((t) => PREMIUM_TOOL_LABELS[t]).join(", ")}.
          {" "}{premiumAccessLine(status)}
        </p>
      )}
      <div className="space-y-4">
        {locked.map((t) => (
          <PremiumLocked key={t} tool={t} status={status} compact />
        ))}
      </div>
    </section>
  );
}
