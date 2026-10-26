import { sessionPending, termsCurrent } from "./session-policy";
import { TERMS_VERSION } from "./terms";

/** Auth.js needs a payload to POST and refresh claims after server verification. */
export async function refreshVerifiedSession<T extends { user?: object }>(
  update: (data: Record<string, never>) => Promise<T | null>,
): Promise<boolean> {
  const next = await update({});
  return !!next?.user && !sessionPending(next.user as { mfa?: unknown; claim?: unknown });
}

/** Re-read saved consent on the server before leaving the acceptance page. */
export async function refreshConsentSession<T extends { user?: object }>(
  update: (data: Record<string, never>) => Promise<T | null>,
): Promise<boolean> {
  // No client-supplied consent claims: the JWT callback reads the database.
  // update() without a payload only GETs the existing, potentially stale JWT.
  const next = await update({});
  const user = next?.user as { terms?: unknown; termsVersion?: unknown; mfa?: unknown; claim?: unknown } | undefined;
  return !!user && !sessionPending(user) && termsCurrent(user, TERMS_VERSION);
}
