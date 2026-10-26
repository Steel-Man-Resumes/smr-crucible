export type DeleteMode = "data" | "account";
export type DeletionProof = { password?: unknown; typedConfirmation?: unknown };

/** The account's stored password determines proof, not how it signed in today. */
export async function deletionProofError(
  passwordHash: string | null,
  proof: DeletionProof,
  matches: (password: string, hash: string) => Promise<boolean>,
): Promise<{ code: string; error: string } | null> {
  if (passwordHash) {
    if (typeof proof.password !== "string" || proof.password.length === 0) {
      return { code: "password_required", error: "Enter your current account password in the deletion field below." };
    }
    if (!(await matches(proof.password, passwordHash))) {
      return { code: "password_incorrect", error: "That password didn't match this account. Try again, or reset your password." };
    }
    return null;
  }
  return proof.typedConfirmation === "DELETE"
    ? null
    : { code: "confirmation_required", error: "Type DELETE in the confirmation field below." };
}
