import type { Metadata, Viewport } from "next";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "./globals.css";
import "./terminal.css";
import { DevToolbar } from "@/components/DevToolbar";
import { AuthProvider } from "@/components/AuthProvider";
import { AnalyticsWrapper } from "@/components/AnalyticsWrapper";

export const metadata: Metadata = {
  title: {
    default: "Steel Man Resumes Career Tools",
    template: "%s | Steel Man Resumes",
  },
  description:
    "Free career intelligence for justice-impacted individuals. Your past doesn't define your paycheck.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  robots: "index, follow",
  metadataBase: new URL("https://forge.steelmanresumes.com"),
  openGraph: {
    title: "Steel Man Resumes Career Tools",
    description:
      "Free career intelligence for justice-impacted individuals. Your past doesn't define your paycheck.",
    siteName: "Steel Man Resumes",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Steel Man Resumes" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Steel Man Resumes Career Tools",
    description: "Free career intelligence for justice-impacted individuals.",
    images: ["/og.png"],
  },
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
          <DevToolbar />
        </AuthProvider>
        <AnalyticsWrapper />
      </body>
    </html>
  );
}
