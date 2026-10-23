import { VERIFY_MAX, sliceWithWarn } from "./limits";

// A full package can contain a 20k original, 20k approved baseline and 28k
// user-confirmed Master Draft details. Other routes retain the existing cap.
export const PACKAGE_VERIFY_SOURCE_MAX = 80000;
export function groundingSourceWindow(source: string, requested?: number): string {
  const limit = typeof requested === "number" && Number.isFinite(requested)
    ? Math.max(VERIFY_MAX, Math.min(PACKAGE_VERIFY_SOURCE_MAX, Math.floor(requested)))
    : VERIFY_MAX;
  return sliceWithWarn(source, limit, "grounding.source");
}
