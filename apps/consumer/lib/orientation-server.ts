import { buildJourneySnapshot, getOneAsUser, runAsUser } from '@crucible/core';
import { ORIENTATION_APPLY_GRANT, ORIENTATION_GRANT, type OrientationReceipt } from './orientation';
import { progressionAccount } from './progression-server';

export async function orientationStatus(userId: string) {
  const [earned, account, grants, snapshot] = await Promise.all([
    getOneAsUser<{ id: string }>(userId, `SELECT id FROM progression_grant WHERE user_id=$1 AND grant_key=$2 AND kind='unlock' AND (expires_at IS NULL OR expires_at>now())`, [userId, ORIENTATION_GRANT]),
    progressionAccount(userId),
    getOneAsUser<{ count: number }>(userId, `SELECT count(DISTINCT step_id)::int AS count FROM progression_grant WHERE user_id=$1 AND kind='unlock' AND step_id IN ('tailor','apply') AND (expires_at IS NULL OR expires_at>now())`, [userId]),
    buildJourneySnapshot(userId),
  ]);
  return { accountId: userId, earned: !!earned, receiptId: earned?.id, previouslyAvailable: account.existing || grants?.count === 2 || snapshot.metrics.resumeTailored };
}

/** Both grants commit together. Unique account/key constraints make replay safe. */
export async function grantOrientation(userId: string): Promise<OrientationReceipt> {
  const before = await orientationStatus(userId);
  const results = await runAsUser<unknown[][]>(userId, sql => [
    sql`INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label)
      VALUES(${userId}::uuid,${ORIENTATION_GRANT},'unlock','tailor','Orientation check passed: tailoring access'),
            (${userId}::uuid,${ORIENTATION_APPLY_GRANT},'unlock','apply','Orientation check passed: application access')
      ON CONFLICT(user_id,grant_key) DO NOTHING RETURNING id,grant_key`,
    sql`SELECT id FROM progression_grant WHERE user_id=${userId}::uuid AND grant_key=${ORIENTATION_GRANT}`,
  ]);
  const id = (results[1]?.[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error('orientation_receipt_missing');
  return { id, alreadyEarned: !results[0]?.length, previouslyAvailable: before.previouslyAvailable };
}
