import { encryptJSON, decryptJSON, type EncryptedPayload } from "./crypto";
import { query, queryAsUser } from "./db";
export interface PackageDelivery { user_id: string; artifact_id: string; revision_id: string; }
/** Scheduler metadata only, through the bounded migration function. */
export async function duePackageDeliveries(): Promise<PackageDelivery[]> {
 await query("SELECT public.purge_package_payloads()");
 return query<PackageDelivery>("SELECT * FROM public.package_delivery_due()");
}
export async function claimPackageDelivery(job: PackageDelivery): Promise<boolean> {
 const rows = await queryAsUser(job.user_id, `UPDATE forge_package_delivery SET due_at = now() + interval '10 minutes', attempts = attempts + 1
 WHERE user_id = $1 AND artifact_id = $2 AND revision_id = $3 AND due_at <= now() RETURNING artifact_id`, [job.user_id, job.artifact_id, job.revision_id]);
 return rows.length > 0;
}
export async function finishPackageDelivery(job: PackageDelivery, retry: boolean, reason: string): Promise<void> {
 if (retry) await queryAsUser(job.user_id, `UPDATE forge_package_delivery SET due_at = now() + interval '30 minutes', last_result = $4
 WHERE user_id = $1 AND artifact_id = $2 AND revision_id = $3`, [job.user_id, job.artifact_id, job.revision_id, reason]);
 else await queryAsUser(job.user_id, `DELETE FROM forge_package_delivery WHERE user_id = $1 AND artifact_id = $2 AND revision_id = $3`, [job.user_id, job.artifact_id, job.revision_id]);
}
export async function completePackageEmailVersion(userId: string, version: string): Promise<void> {
 await queryAsUser(userId, `UPDATE forge_package_email_sent SET delivered_at = now(), lease_until = NULL, payload_encrypted = NULL WHERE user_id = $1 AND version = $2`, [userId, version]);
}

/** Persist the exact encrypted request before transport. Retries must be byte-identical,
 * including generated attachment timestamps. It is erased after provider acceptance. */
export async function preparePackageEmail<T>(userId: string, version: string, mail: T): Promise<T> {
 const aad = `${userId}:package-email:${version}`;
 const payload = encryptJSON(mail, aad);
 const [row] = await queryAsUser<{ payload_encrypted: EncryptedPayload }>(userId,
  `UPDATE forge_package_email_sent SET payload_encrypted = COALESCE(payload_encrypted, $3::jsonb), attempted_at = COALESCE(attempted_at, now())
   WHERE user_id = $1 AND version = $2 AND delivered_at IS NULL RETURNING payload_encrypted`, [userId, version, JSON.stringify(payload)]);
 if (!row) throw new Error("Delivery claim no longer available");
 return decryptJSON<T>(row.payload_encrypted, aad);
}
