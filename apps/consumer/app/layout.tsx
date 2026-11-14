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
import { AccountLanguageSync } from "@/components/AccountLanguageSync";
import { ServerTextProvider } from "@/components/ServerTextProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: {
    default: "Steel Man Resumes Career Tools",
    template: "%s | Steel Man Resumes",
  },
  description:
    "A free career report for justice-impacted individuals. Your past doesn't define your paycheck.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  robots: "index, follow",
  metadataBase: new URL("https://forge.steelmanresumes.com"),
  openGraph: {
    title: "Steel Man Resumes Career Tools",
    description:
      "A free career report for justice-impacted individuals. Your past doesn't define your paycheck.",
    siteName: "Steel Man Resumes",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Steel Man Resumes" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Steel Man Resumes Career Tools",
    description: "A free career report for justice-impacted individuals.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Site language (i18n/locale.ts): from the cookie, per request. The <html lang>
  // tells screen readers and the browser which language the page speaks.
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <AccountLanguageSync />
            <ServerTextProvider>
              {children}
              <DevToolbar />
            </ServerTextProvider>
          </AuthProvider>
        </NextIntlClientProvider>
        <AnalyticsWrapper />
      </body>
    </html>
  );
}
