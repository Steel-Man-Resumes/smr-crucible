import type { Metadata } from "next";
import type { ReactNode } from "react";

// /intro is the app's one indexable page (see app/sitemap.ts). The page is a
// client component, so its canonical tag lives here. metadataBase in the root
// layout makes this https://forge.steelmanresumes.com/intro.
export const metadata: Metadata = {
  alternates: { canonical: "/intro" },
};

export default function IntroLayout({ children }: { children: ReactNode }) {
  return children;
}
