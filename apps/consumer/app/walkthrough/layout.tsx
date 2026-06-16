import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forge + Refinery: A Guided Walkthrough | Steel Man Resumes",
  description:
    "A two-minute guided look at how The Forge and The Refinery turn a plain resume into a strengths-first roadmap for justice-impacted job seekers.",
  // Private partner-share asset, not a marketing page.
  robots: "noindex, nofollow",
};

export default function WalkthroughLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
