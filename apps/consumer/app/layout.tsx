import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DevToolbar } from "@/components/DevToolbar";
import { AuthProvider } from "@/components/AuthProvider";
import { GlobalTourOverlay } from "@/components/tour/GlobalTourOverlay";

export const metadata: Metadata = {
  title: "Steel Man Resumes",
  description:
    "Free career intelligence for justice-impacted individuals. Your past doesn't define your paycheck.",
  robots: "index, follow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          {children}
          <GlobalTourOverlay />
          <DevToolbar />
        </AuthProvider>
      </body>
    </html>
  );
}
