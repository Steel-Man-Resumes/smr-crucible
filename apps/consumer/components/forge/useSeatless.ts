"use client";

import { useSession } from "next-auth/react";
import { seatlessSession } from "@/lib/refinery-access";

/**
 * True for a signed-in account without a Refinery seat, once public sign-ups
 * are closed. For page copy and links only: the edge and AI admission enforce
 * the seat (lib/refinery-access.ts), never this hook.
 */
export function useSeatless(): boolean {
  const { data } = useSession();
  return seatlessSession(data?.user as { seatOpen?: unknown; seat?: unknown } | undefined);
}
