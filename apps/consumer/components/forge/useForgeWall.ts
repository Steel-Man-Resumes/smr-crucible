"use client";

import { useEffect, useState } from "react";
import { forgeWallState, type ForgeWall } from "@/lib/forge-access";

/**
 * The wall's state in the browser, read after mount. Pages are pre-rendered at
 * build time, and the wall depends on today's date, so the first render must
 * not depend on it (it would not match the server's HTML). null until known.
 */
export function useForgeWall(): ForgeWall | null {
  const [wall, setWall] = useState<ForgeWall | null>(null);
  useEffect(() => setWall(forgeWallState()), []);
  return wall;
}
