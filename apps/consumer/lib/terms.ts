/**
 * The Terms, Privacy and AI-processing acceptance every account gives before
 * any Forge data is kept or processed: the one version string, the links, and
 * the SQL that records it. Pure (no imports): the edge middleware, the
 * sign-in callbacks, the routes and the tests share it.
 *
 * The terms text itself lives on the public site (TERMS_URL, PRIVACY_URL) and
 * is not changed here.
 */

/** Bump only when the notice at the links below materially changes. */
export const TERMS_VERSION = "2026-08-21-v1";

export const TERMS_URL = "https://steelmanresumes.com/terms";
export const PRIVACY_URL = "https://steelmanresumes.com/privacy";

/** The page an account that has not accepted is sent to (one tap). */
export const TERMS_PAGE = "/login/terms";

/** Has this account accepted the current version? ($1 user id, $2 version) */
export const CONSENT_LOOKUP_SQL = `SELECT 1 FROM consumer_consent
  WHERE user_id = $1::uuid AND consent_layer = 'core' AND status = 'granted'
    AND consent_text_version = $2
  LIMIT 1`;

/** The current-state row, as registration writes it. ($1 user, $2 version, $3 context json) */
export const CONSENT_UPSERT_SQL = `INSERT INTO consumer_consent
     (user_id, consent_layer, status, consent_text_version, collection_context)
   VALUES ($1, 'core', 'granted', $2, $3)
   ON CONFLICT (user_id, consent_layer)
   DO UPDATE SET status = 'granted', granted_at = now(),
                 consent_text_version = $2, collection_context = $3`;

/** The immutable history row. ($1 user, $2 version, $3 collection method, $4 context json) */
export const CONSENT_EVENT_SQL = `INSERT INTO consumer_consent_event
     (user_id, consent_layer, action, text_version, collection_method, context)
   VALUES ($1, 'core', 'granted', $2, $3, $4)`;

/** How the account came in, as the consent ledger records it. */
export function consentMethodFor(provider: unknown): "registration" | "email_link" | "google" | "sign_in" {
  if (provider === "resend") return "email_link";
  if (provider === "google") return "google";
  if (provider === "password-login") return "sign_in";
  return "sign_in";
}

/** The same three acceptances registration records. */
export const CONSENT_CONTEXT = { terms: true, privacy: true, ai_processing: true } as const;
