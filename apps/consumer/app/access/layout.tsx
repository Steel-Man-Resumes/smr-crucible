import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Partner Access",
  description: "Partner access and orientation for Steel Man Resumes career tools.",
  icons: {
    icon: [{ url: "/brand/refinery-icon.png", type: "image/png", sizes: "512x512" }],
  },
  robots: "noindex, nofollow",
};

export default function AccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
