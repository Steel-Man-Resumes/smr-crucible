import { signOut } from "next-auth/react";

/** Keep browser work until the server confirms the account is signed out. */
export async function confirmedSignOut(): Promise<void> {
  await signOut({ redirect: false });
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error("Sign-out could not be confirmed");
  const session = await response.json();
  if (session?.user) throw new Error("Still signed in");
}
