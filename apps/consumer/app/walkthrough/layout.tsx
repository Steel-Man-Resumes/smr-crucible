import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forge + Refinery: A Guided Walkthrough | Steel Man Resumes",
  description:
    "A guided look at Steel Man Resumes on real screens: the Mini Forge inside, the Forge, the Refinery, verified employers, and the staff workspace programs use.",
  icons: {
    icon: [{ url: "/brand/refinery-icon.png", type: "image/png", sizes: "512x512" }],
  },
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
