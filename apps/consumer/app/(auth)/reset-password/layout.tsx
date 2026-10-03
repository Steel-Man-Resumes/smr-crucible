import type { Metadata } from "next";

// The reset link's token and email are in this page's query string: never pass
// the URL on as a referrer (also set as a response header in next.config.mjs).
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
