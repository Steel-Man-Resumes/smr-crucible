import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RefineryShell } from "./RefineryShell";

export const metadata: Metadata = {
  title: "The Refinery",
  description: "Career materials, job tools, and progress in one Steel Man Resumes workspace.",
  icons: {
    icon: [{ url: "/brand/refinery-icon.png", type: "image/png", sizes: "512x512" }],
  },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <RefineryShell>{children}</RefineryShell>;
}
