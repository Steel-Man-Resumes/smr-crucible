import { signOut } from "next-auth/react";
import { clearOrgNoteDrafts } from "./org-note-draft";

/** Keep browser work until the server confirms the account is signed out. */
export async function confirmedSignOut(): Promise<void> {
  let lastError: Error = new Error("Sign-out could not be confirmed");
  // A first sign-out can return 200 while a fresh session read still has a user.
  // Retry once, then leave browser work intact if confirmation still fails.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await signOut({ redirect: false });
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error("Sign-out could not be confirmed");
      const session = await response.json();
      if (!session?.user) {
        // Signed out for sure: staff drafts in this tab go with the account.
        clearOrgNoteDrafts();
        return;
      }
      lastError = new Error("Still signed in");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Sign-out could not be confirmed");
    }
  }
  throw lastError;
}
