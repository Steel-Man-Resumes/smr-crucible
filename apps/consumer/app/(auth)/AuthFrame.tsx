"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WORKSHOP_SCOPE } from "./workshopScope";

/**
 * Page frame for the sign-in pages. On /login the header and page share the
 * workshop palette so it reads as one page; the other auth pages keep the
 * light frame. Styling only.
 */
export function AuthFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  const dark = usePathname() === "/login";
  return (
    <div
      style={dark ? WORKSHOP_SCOPE : undefined}
      className="refinery-app min-h-screen bg-t-bg"
    >
      <header
        className={`border-b border-t-line ${
          dark ? "bg-t-bg [&_img]:brightness-0 [&_img]:invert" : "bg-white"
        }`}
      >
        {header}
      </header>
      {children}
    </div>
  );
}
