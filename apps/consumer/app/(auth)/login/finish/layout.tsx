import type { Metadata } from "next";

// The sign-in link's token and email are in this page's query string: never
// pass the URL on as a referrer (also set as a response header in
// next.config.mjs).
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function FinishLayout({ children }: { children: React.ReactNode }) {
  return children;
}
