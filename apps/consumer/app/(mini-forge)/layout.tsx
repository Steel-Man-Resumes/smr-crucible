/**
 * Mini Forge layout -- stripped for tablet compatibility.
 *
 * Hard constraints:
 * - No third-party scripts (no analytics, no speed-insights)
 * - No external links
 * - No CDN assets
 * - Works at 360px minimum width
 * - All assets self-hosted
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "The Mini Forge -- Steel Man Resumes",
  description: "Career planning. Start here.",
  robots: { index: false, follow: false },
};

export default function MiniForgeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4 border-b border-border">
        <span className="text-sm font-semibold tracking-wide text-foreground">
          Steel Man Resumes
        </span>
      </header>
      <main className="max-w-lg mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
