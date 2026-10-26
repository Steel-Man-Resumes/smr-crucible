-- 101_roles_and_codes.sql (dry run)
-- READ-ONLY. Makes no writes: run inside BEGIN READ ONLY; ... ROLLBACK; as the
-- owner, on production or a fresh branch of it, BEFORE and AFTER applying 101.
-- Ids only, never names or emails (this file is in a public repo; the output
-- is not). House lane L2, 2026-10-26.
--
-- WHAT IT SHOWS
--   1. Platform admins who hold a membership (redemption). 101 stops new ones;
--      it does not remove these. Each is an owner decision (leave the org via
--      smr_leave_org, never a bare DELETE).
--   2. Owners or staff who are ALSO participants of the same organization.
--      Same: 101 stops new ones only.
--   3. THE RE-TIER PREVIEW. After the L2 app release, users.tier follows the
--      org role: partner for someone who owns an active organization or holds
--      an org_staff row in one, client for everyone else (codes no longer
--      make partners). This lists every account whose cached tier differs
--      from that rule, with the reason. Platform admins are excluded (the
--      047 trigger pins them). Observers are listed but NOT changed.
--   4. The counts the re-tier UPDATE below must match.
--
-- THE RE-TIER ITSELF is at the bottom, commented out. It is a boss step after
-- the app release (the old app re-derives partner from codes on the next
-- redeem, so running it first would be undone). Run it through neon-run with
-- a backup, a count guard equal to section 4, then CHECK = section 3 empty
-- except observers.

BEGIN READ ONLY;

-- org_staff and access_code_redemption are FORCE RLS. Without BYPASSRLS this
-- would see NO staff and NO memberships, preview every partner as "goes to
-- client", and section 4 would agree with it. Stop instead (fix round 1).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '101 dry run needs a role with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

-- Role facts per account, active organizations only (the app's own rule).
-- A CTE in each query, not a temp view: a READ ONLY transaction refuses
-- CREATE, and 082 removed TEMP from non-owner roles.

-- 1. platform admins holding a membership
SELECT 'admin_is_participant' AS finding, r.user_id, r.access_code_id, r.redeemed_at
  FROM access_code_redemption r
  JOIN platform_admin pa ON pa.user_id = r.user_id
 ORDER BY r.redeemed_at;

-- 2. owners or staff who are participants of their own organization
SELECT 'staff_is_participant_same_org' AS finding, r.user_id, r.access_code_id,
       CASE WHEN ac.partner_user_id = r.user_id THEN 'owner' ELSE os.role END AS staff_role
  FROM access_code_redemption r
  JOIN access_code ac ON ac.id = r.access_code_id
  LEFT JOIN org_staff os ON os.access_code_id = r.access_code_id AND os.user_id = r.user_id
 WHERE ac.partner_user_id = r.user_id OR os.user_id IS NOT NULL
 ORDER BY r.access_code_id;

-- 3. re-tier preview
WITH l2_roles AS (
  SELECT u.id AS user_id,
         u.tier,
         EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = u.id) AS is_admin,
         (EXISTS (SELECT 1 FROM access_code ac WHERE ac.partner_user_id = u.id AND ac.is_active)
          OR EXISTS (SELECT 1 FROM org_staff os JOIN access_code ac ON ac.id = os.access_code_id
                      WHERE os.user_id = u.id AND ac.is_active)) AS holds_staff_role,
         EXISTS (SELECT 1 FROM access_code_redemption r JOIN access_code ac ON ac.id = r.access_code_id
                  WHERE r.user_id = u.id AND ac.is_active AND (ac.expires_at IS NULL OR ac.expires_at > now())
                    AND ac.tier IN ('partner', 'unlimited')) AS has_partner_code
    FROM users u
)
SELECT user_id, tier AS tier_now,
       CASE WHEN holds_staff_role THEN 'partner' ELSE 'client' END AS tier_by_role,
       CASE
         WHEN tier = 'observer' THEN 'observer: listed only, not changed'
         WHEN tier = 'partner' AND has_partner_code THEN 'participant of a partner-tier code, no staff role (H3)'
         WHEN tier = 'partner' THEN 'partner with no active staff role and no partner code (closed org, pre-authorized, or manual): CHANGES'
         WHEN tier = 'client' THEN 'owns or works in an org but cached as client (H4)'
       END AS why
  FROM l2_roles
 WHERE NOT is_admin
   AND tier IN ('client', 'partner', 'observer')
   AND tier IS DISTINCT FROM (CASE WHEN holds_staff_role THEN 'partner' ELSE 'client' END)
   AND NOT (tier = 'observer' AND NOT holds_staff_role)
 ORDER BY why, user_id;

-- 4. the counts the UPDATE must match
WITH l2_roles AS (
  SELECT u.id AS user_id,
         u.tier,
         EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = u.id) AS is_admin,
         (EXISTS (SELECT 1 FROM access_code ac WHERE ac.partner_user_id = u.id AND ac.is_active)
          OR EXISTS (SELECT 1 FROM org_staff os JOIN access_code ac ON ac.id = os.access_code_id
                      WHERE os.user_id = u.id AND ac.is_active)) AS holds_staff_role,
         EXISTS (SELECT 1 FROM access_code_redemption r JOIN access_code ac ON ac.id = r.access_code_id
                  WHERE r.user_id = u.id AND ac.is_active AND (ac.expires_at IS NULL OR ac.expires_at > now())
                    AND ac.tier IN ('partner', 'unlimited')) AS has_partner_code
    FROM users u
)
SELECT count(*) FILTER (WHERE tier = 'partner' AND NOT holds_staff_role) AS partner_to_client,
       count(*) FILTER (WHERE tier = 'client' AND holds_staff_role)      AS client_to_partner
  FROM l2_roles
 WHERE NOT is_admin;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- RE-TIER (boss step after the L2 app release; NOT part of migration 101).
-- Paste into neon-run as one guarded transaction. Replace :expect_down and
-- :expect_up with section 4's numbers from the LOOK run.
--
-- BEGIN;
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
--     RAISE EXCEPTION '101 re-tier needs a role with BYPASSRLS; % has none (it would demote every staff member)', current_user;
--   END IF;
-- END $$;
-- WITH r AS (
--   SELECT u.id,
--          (EXISTS (SELECT 1 FROM access_code ac WHERE ac.partner_user_id = u.id AND ac.is_active)
--           OR EXISTS (SELECT 1 FROM org_staff os JOIN access_code ac ON ac.id = os.access_code_id
--                       WHERE os.user_id = u.id AND ac.is_active)) AS staff
--     FROM users u
--    WHERE NOT EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = u.id)
-- ), down AS (
--   UPDATE users u SET tier = 'client' FROM r
--    WHERE r.id = u.id AND u.tier = 'partner' AND NOT r.staff RETURNING u.id
-- ), up AS (
--   UPDATE users u SET tier = 'partner' FROM r
--    WHERE r.id = u.id AND u.tier = 'client' AND r.staff RETURNING u.id
-- )
-- SELECT (SELECT count(*) FROM down) AS down, (SELECT count(*) FROM up) AS up;
-- -- COMMIT only if down = :expect_down AND up = :expect_up; otherwise ROLLBACK.
