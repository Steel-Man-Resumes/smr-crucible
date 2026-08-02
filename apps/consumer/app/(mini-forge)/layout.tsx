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
import { ProductFamilyBrand } from "@/components/brand/BrandMarks";

export const metadata: Metadata = {
  title: "The Mini Forge",
  description: "Career planning. Start here.",
  icons: {
    icon: [{ url: "/brand/forge-icon.png", type: "image/png", sizes: "512x512" }],
  },
  robots: { index: false, follow: false },
};

export default function MiniForgeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-t-bg">
      <header className="border-b border-t-line bg-white px-4 py-3">
        <div className="mx-auto flex h-12 max-w-lg items-center">
          <ProductFamilyBrand product="forge" />
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">{children}</main>
    </div>
  );
}
