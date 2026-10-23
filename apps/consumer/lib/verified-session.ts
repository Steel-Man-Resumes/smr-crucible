import { sessionPending } from "./session-policy";

/** Auth.js needs a payload to POST and refresh claims after server verification. */
export async function refreshVerifiedSession<T extends { user?: object }>(
  update: (data: Record<string, never>) => Promise<T | null>,
): Promise<boolean> {
  const next = await update({});
  return !!next?.user && !sessionPending(next.user as { mfa?: unknown; claim?: unknown });
}
