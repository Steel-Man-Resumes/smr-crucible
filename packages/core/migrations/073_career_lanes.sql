-- 073_career_lanes.sql
-- Career lanes under one account.
--
-- One person can aim at several kinds of work at once: warehouse, kitchen,
-- caregiving. Each aim is a LANE: one target, its own resumes and letters, its
-- own format and length setting. Underneath every lane sits ONE set of facts,
-- the person's real history, kept where it already lives (consumer_profile and
-- the Forge output). A lane never holds a copy of the facts, so nothing can
-- drift between lanes at this layer.
--
-- WHAT THIS ADDS
--   career_lane              one row per lane. Archived, never hard deleted by
--                            the app; only "delete my data" and account
--                            deletion remove rows.
--   lane_tool_intro          which tool introductions a person has dismissed,
--                            per lane (lane_key = the lane id, or 'main').
--   refinery_artifact.lane_id  optional; NULL means the "main" lane, so every
--                            existing resume and letter keeps working untouched.
--   refinery_artifact.is_demo  examples and test resumes, hidden by default
--                            behind "Show examples". Set by 074, never deleted.
--
-- FORMAT RULE IN THE DATABASE. A lane's format is 'chronological' (dated
-- history first, the default) or 'hybrid' (a short skills block above the
-- full dated history). Hybrid is allowed only when the person has confirmed
-- BOTH conditions: an uneven history AND a skill-driven change of field. A
-- dateless functional format is not a value the column accepts.
--
-- OWNERSHIP. Both new tables are owner only, the same policy shape as
-- vault_document (059): the row's user_id is the person the request runs as,
-- for every command. refinery_artifact.lane_id is a composite foreign key on
-- (lane_id, user_id), so a resume can only ever sit in a lane its own owner
-- holds, whatever id a request sends. (Foreign-key checks do not go through
-- row-level security, which is what makes the composite key the guard.)
--
-- Additive and idempotent. Nothing reads these columns until the lane code is
-- live; old code ignores them.
--
-- LOCKS. Adding the columns and the foreign key takes an ACCESS EXCLUSIVE
-- lock on refinery_artifact for the length of the transaction (a fast
-- metadata change plus one validation scan; every lane_id is NULL at apply
-- time). lock_timeout makes it give up after 5 seconds instead of queueing
-- every resume request behind a long-running query. If it times out, run it
-- again.
--
-- ROLLBACK, in this order:
--   1. Revert the lane CODE first and deploy that. Live lane code queries
--      lane_id and is_demo (the Library, the Tailor, the export, the RLS
--      health check) and breaks the moment these columns are gone.
--   2. Rolling back LOSES ALL LANE DATA for good: lane names, settings, which
--      resume sits in which lane, the example marks, dismissed tool notes. If
--      anyone has used lanes, export them first.
--   3. Then, as the owner role:
--        ALTER TABLE refinery_artifact DROP COLUMN IF EXISTS lane_id;
--        ALTER TABLE refinery_artifact DROP COLUMN IF EXISTS is_demo;
--        DROP TABLE IF EXISTS lane_tool_intro;
--        DROP TABLE IF EXISTS career_lane;
--        DELETE FROM _migrations WHERE filename IN ('073_career_lanes.sql', '074_mark_demo_resumes.sql');

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS career_lane (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The name the person picks ("Warehouse"). Short, shown on every lane tool.
  name                   TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- The kind of job this lane aims at, in the person's words.
  target_role            TEXT CHECK (target_role IS NULL OR length(target_role) <= 200),
  format                 TEXT NOT NULL DEFAULT 'chronological'
                           CHECK (format IN ('chronological', 'hybrid')),
  -- The two hybrid conditions, each confirmed by the person.
  hybrid_uneven_history  BOOLEAN NOT NULL DEFAULT false,
  hybrid_field_change    BOOLEAN NOT NULL DEFAULT false,
  length_pref            TEXT NOT NULL DEFAULT 'auto'
                           CHECK (length_pref IN ('auto', 'one_page', 'two_pages')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at            TIMESTAMPTZ,
  -- The lane made automatically from the first Forge resume. At most one per
  -- person (index below), so two tabs saving at once cannot make two.
  is_first               BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT career_lane_hybrid_needs_both_conditions
    CHECK (format <> 'hybrid' OR (hybrid_uneven_history AND hybrid_field_change)),
  -- Target of the composite foreign key below.
  CONSTRAINT career_lane_id_user_key UNIQUE (id, user_id)
);

-- One open lane per name per person ("Warehouse" twice would be confusing).
CREATE UNIQUE INDEX IF NOT EXISTS career_lane_open_name_uniq
  ON career_lane (user_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_career_lane_user
  ON career_lane (user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS career_lane_one_first_uniq
  ON career_lane (user_id) WHERE is_first;

CREATE TABLE IF NOT EXISTS lane_tool_intro (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A lane id as text, or 'main' for work outside any named lane.
  lane_key      TEXT NOT NULL CHECK (lane_key = 'main' OR lane_key ~ '^[0-9a-f-]{36}$'),
  tool          TEXT NOT NULL CHECK (tool IN ('tailor', 'library')),
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lane_key, tool)
);

ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS lane_id UUID;
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refinery_artifact_lane_owner_fk') THEN
    -- NO ACTION (not RESTRICT): when an account is deleted, its lanes and its
    -- artifacts go in the same cascade and the check passes at statement end.
    ALTER TABLE refinery_artifact
      ADD CONSTRAINT refinery_artifact_lane_owner_fk
      FOREIGN KEY (lane_id, user_id) REFERENCES career_lane (id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refinery_artifact_lane
  ON refinery_artifact (user_id, lane_id) WHERE lane_id IS NOT NULL;

-- Owner only, every command (same shape as 059).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['career_lane', 'lane_tool_intro'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
                                                 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_delete', t);
  END LOOP;
END $$;

-- DELETE is granted for "delete my data" only; the lane screens archive.
DO $$
BEGIN
  REVOKE ALL ON career_lane, lane_tool_intro FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON career_lane, lane_tool_intro TO smr_app;
  END IF;
END $$;
