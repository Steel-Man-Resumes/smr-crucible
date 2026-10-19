import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forge + Refinery: A Guided Walkthrough | Steel Man Resumes",
  description:
    "A guided look at the Forge and the Refinery on the real screens: the resume, the record on the page, every job search tool, employers, local help and the program view.",
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
