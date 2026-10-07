import type { Metadata } from "next";
import type { ReactNode } from "react";

// The free checker is public and indexable (see app/sitemap.ts). The page is a
// client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Free resume check",
  description:
    "Paste your resume or upload the file. See what to fix before you send it. Free, no sign-in, and we don't save it.",
  alternates: { canonical: "/check" },
};

export default function CheckLayout({ children }: { children: ReactNode }) {
  return children;
}
