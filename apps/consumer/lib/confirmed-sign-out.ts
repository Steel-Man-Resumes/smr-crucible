import { signOut } from "next-auth/react";
import { clearTailorBatchStorage } from "./tailor-batch";

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
      // Multi-job picks and queues (job titles, employers) never outlive the account in this tab.
      if (!session?.user) { clearTailorBatchStorage(); return; }
      lastError = new Error("Still signed in");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Sign-out could not be confirmed");
    }
  }
  throw lastError;
}
