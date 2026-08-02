import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ForgeShell } from "./ForgeShell";

export const metadata: Metadata = {
  title: "The Forge",
  description: "Turn your experience into a clear career plan with Steel Man Resumes.",
  icons: {
    icon: [{ url: "/brand/forge-icon.png", type: "image/png", sizes: "512x512" }],
  },
};

export default function ForgeLayout({ children }: { children: ReactNode }) {
  return <ForgeShell>{children}</ForgeShell>;
}
