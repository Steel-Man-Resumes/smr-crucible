"use client";

/**
 * Copy that follows the Forge sign-in wall (lib/forge-access.ts). Before the
 * wall goes up the Forge needs no account; after, it needs one free sign-in.
 * The wall turns on by date, and pages are pre-rendered, so nothing shows
 * until the browser knows which is true (never a claim that may be stale).
 * Usable from server components: pass the two versions as elements.
 */

import type { ReactNode } from "react";
import { useForgeWall } from "./useForgeWall";

export function WallText({ open, up }: { open: ReactNode; up: ReactNode }) {
  const wall = useForgeWall();
  if (wall === null) return null;
  return <>{wall === "up" ? up : open}</>;
}
