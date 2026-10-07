"use client";

/**
 * Quiet shell: lets a Forge page ask the shell to hide its chrome so the page
 * can be full-focus (for example the processing wait).
 *
 * Three ways to turn it on, any one is enough:
 *   1. A page calls `useQuietShell()` (or `useQuietShell(someCondition)`).
 *   2. The route is listed in QUIET_PATHS in ForgeShell.tsx (no flash of chrome).
 *   3. `<ForgeShell quiet>` in a layout.
 *
 * Quiet hides the progress bar, the "Private by design" note, the Leave
 * button, the t.ROY chat drawer and the sharing prompt. It keeps the brand
 * mark and the "Clear this computer" button, because that control must stay
 * visible while any of the person's work is on screen.
 */

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

interface QuietShellValue {
  quiet: boolean;
  setQuiet: (quiet: boolean) => void;
}

const QuietShellContext = createContext<QuietShellValue>({
  quiet: false,
  setQuiet: () => {},
});

export function QuietShellProvider({ children }: { children: ReactNode }) {
  const [quiet, setQuiet] = useState(false);
  return (
    <QuietShellContext.Provider value={{ quiet, setQuiet }}>
      {children}
    </QuietShellContext.Provider>
  );
}

export function useQuietShellState(): boolean {
  return useContext(QuietShellContext).quiet;
}

// useLayoutEffect warns during server render; fall back to useEffect there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Call from a page to hide the shell chrome while that page is mounted. */
export function useQuietShell(enabled: boolean = true): void {
  const { setQuiet } = useContext(QuietShellContext);
  useIsoLayoutEffect(() => {
    if (!enabled) return;
    setQuiet(true);
    return () => setQuiet(false);
  }, [enabled, setQuiet]);
}
