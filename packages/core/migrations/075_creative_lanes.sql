-- 075_creative_lanes.sql
-- Creative lanes, the practice record, and the realistic/dream pair.
--
-- A lane (073) aims at one kind of work. This adds a lane KIND: 'resume' (every
-- lane so far) or 'creative' (an artist resume, a bio, the person's own
-- statement and a work-sample list, for one practice). More kinds come later
-- (a CV, a performer page): each is one more value in career_lane_kind_check,
-- swapped by its own migration.
--
-- WHAT THIS ADDS
--   career_lane.kind           'resume' (default, every existing row) | 'creative'
--   career_lane.path           NULL, 'realistic' or 'dream' (the two-path plan)
--   career_lane.pair_lane_id   the other lane of a realistic/dream pair, or NULL
--   career_lane.kind_settings  per-lane choices for a non-resume kind (page cap,
--                              how a title that names a facility shows, bio
--                              disclosure mode). Choices only, never facts.
--   career_lane.pair_plan      the private plan card of a pair (goal, next
--                              steps, where to get help), on the dream lane only.
--   practice_entry             the practice record: shows, performances,
--                              residencies, commissions, publications, press,
--                              collections, teaching, arts programs, awards,
--                              education and works. One row per entry, in the
--                              person's own words, each with its own year and
--                              a proof mark. Owner only.
--   refinery_artifact types    artist_resume, artist_bio, artist_statement,
--                              work_sample_list (and follow_up, which the app
--                              already sends but migration 005 never allowed).
--
-- ONE SET OF FACTS. A lane still never holds a copy of a fact. The practice
-- record is the one place a show, a title or a year lives; every lane and
-- every document reads it. kind_settings and pair_plan hold choices and the
-- person's plan, not history.
--
-- THE PAIR. A realistic lane and a dream lane can point at each other. The
-- database keeps the pair honest: both rows point at each other, one is
-- realistic and the other is dream, both belong to the same person (composite
-- key, as in 073), and a lane is in at most one pair. The two-sided check is a
-- deferred constraint trigger, so the app links both rows in one statement and
-- the check runs at commit.
--
-- OWNERSHIP. practice_entry is owner only for every command, the same policy
-- shape as career_lane (073). FORCE row-level security, so even the table
-- owner's app role is held to it. The pair trigger runs as the caller, under
-- the same policies, and only ever looks at the caller's own lanes.
--
-- POSTGRES 15 OR LATER. ON DELETE SET NULL (pair_lane_id) needs it. Check
-- `SHOW server_version` on the target before applying.
--
-- LOCKS. Adding columns is a metadata change (fast defaults). The new foreign
-- key and the artifact type CHECK each scan their table once while holding a
-- strong lock until commit. lock_timeout makes the file give up after 5
-- seconds instead of queueing every resume request behind a long query. If it
-- times out, run it again; every statement is idempotent.
--
-- ROLLBACK, in this order:
--   1. Revert the creative lane CODE first and deploy that. Live code reads
--      kind, path, pair_lane_id, kind_settings, pair_plan and practice_entry
--      (and /api/health/rls counts practice_entry), and breaks the moment they
--      are gone.
--   2. Rolling back LOSES the practice record, every creative document
--      (artist resumes, bios, statements and their versions, sample lists),
--      lane kinds, pairs and plan cards. Export first if anyone has used them.
--   3. Then, as the owner role, in one transaction:
--        DELETE FROM refinery_artifact WHERE artifact_type IN
--          ('artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list');
--        ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_artifact_type_check;
--        ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_artifact_type_check
--          CHECK (artifact_type IN ('resume', 'cover_letter', 'follow_up', 'disclosure_plan',
--                                   'interview_prep', 'resource_list', 'job_match'));
--        DROP TABLE IF EXISTS practice_entry;
--        DROP TRIGGER IF EXISTS career_lane_pair_symmetric ON career_lane;
--        DROP FUNCTION IF EXISTS career_lane_pair_check();
--        ALTER TABLE career_lane DROP CONSTRAINT IF EXISTS career_lane_pair_owner_fk;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS pair_plan;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS kind_settings;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS pair_lane_id;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS path;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS kind;
--        DELETE FROM _migrations WHERE filename = '075_creative_lanes.sql';
--      (The rollback CHECK keeps follow_up; leave it in. Dropping it would
--      refuse a value the app already sends.)

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------- lanes --

ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'resume';
ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS pair_lane_id UUID;
ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS kind_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS pair_plan JSONB;

DO $$
BEGIN
  -- Later kinds (cv, performer, services) replace this one constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_kind_check') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_kind_check
      CHECK (kind IN ('resume', 'creative'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_path_check') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_path_check
      CHECK (path IS NULL OR path IN ('realistic', 'dream'));
  END IF;
  -- A pair needs a path on this side and is never the lane itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_pair_shape') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_pair_shape
      CHECK (pair_lane_id IS NULL OR (pair_lane_id <> id AND path IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_kind_settings_shape') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_kind_settings_shape
      CHECK (jsonb_typeof(kind_settings) = 'object' AND octet_length(kind_settings::text) <= 16000);
  END IF;
  -- The plan card lives on the dream side only, and stays small.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_pair_plan_shape') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_pair_plan_shape
      CHECK (pair_plan IS NULL OR (path = 'dream' AND jsonb_typeof(pair_plan) = 'object'
                                   AND octet_length(pair_plan::text) <= 8000));
  END IF;
  -- Same composite owner key as 073: a lane can only pair with a lane its own
  -- owner holds. If the other lane is ever removed, this side simply unpairs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_pair_owner_fk') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_pair_owner_fk
      FOREIGN KEY (pair_lane_id, user_id) REFERENCES career_lane (id, user_id)
      ON DELETE SET NULL (pair_lane_id);
  END IF;
END $$;

-- A lane is in at most one pair.
CREATE UNIQUE INDEX IF NOT EXISTS career_lane_pair_uniq
  ON career_lane (pair_lane_id) WHERE pair_lane_id IS NOT NULL;

-- Both sides of a pair point at each other, and the paths differ. Checked at
-- commit (deferred), as the caller: only the caller's own lanes are visible,
-- and the composite key above already keeps a pair inside one account.
CREATE OR REPLACE FUNCTION career_lane_pair_check() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  cur career_lane%ROWTYPE;
  other career_lane%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM career_lane WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL; -- the row is gone by commit; the foreign key handled the other side
  END IF;
  IF cur.pair_lane_id IS NOT NULL THEN
    SELECT * INTO other FROM career_lane WHERE id = cur.pair_lane_id;
    IF NOT FOUND OR other.pair_lane_id IS DISTINCT FROM cur.id THEN
      RAISE EXCEPTION 'career_lane pair must point both ways' USING ERRCODE = '23514';
    END IF;
    IF other.path IS NULL OR cur.path IS NULL OR other.path = cur.path THEN
      RAISE EXCEPTION 'career_lane pair needs one realistic and one dream lane' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Nobody may still point at this lane unless this lane points back.
  IF EXISTS (SELECT 1 FROM career_lane x
              WHERE x.pair_lane_id = cur.id
                AND x.id IS DISTINCT FROM cur.pair_lane_id) THEN
    RAISE EXCEPTION 'career_lane pair must point both ways' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS career_lane_pair_symmetric ON career_lane;
CREATE CONSTRAINT TRIGGER career_lane_pair_symmetric
  AFTER INSERT OR UPDATE OF pair_lane_id, path ON career_lane
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION career_lane_pair_check();

-- ------------------------------------------------------ practice record --

CREATE TABLE IF NOT EXISTS practice_entry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section         TEXT NOT NULL CHECK (section IN (
                    'exhibition', 'performance', 'residency', 'commission',
                    'publication', 'press', 'collection', 'teaching',
                    'arts_program', 'award', 'education', 'work')),
  -- The name of the show, work, publication, program, award or degree, exactly
  -- as the person gives it. Never renamed per lane.
  title           TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  -- Gallery, venue, outlet, organization, giver, holder, school or sponsor.
  venue           TEXT CHECK (venue IS NULL OR length(venue) <= 200),
  city            TEXT CHECK (city IS NULL OR length(city) <= 100),
  state           TEXT CHECK (state IS NULL OR length(state) <= 60),
  -- Every entry is dated (years at the left of the page).
  year            INT NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  end_year        INT CHECK (end_year IS NULL OR (end_year BETWEEN 1900 AND 2100 AND end_year >= year)),
  -- Section-specific facts in the person's words (kind of show, status,
  -- medium, size, role, quote...). Shape checked by the app.
  details         JSONB NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8000),
  -- checked: a record backs it. remembered: the person's memory. need_to_find:
  -- they know it happened and are finding the proof.
  proof           TEXT NOT NULL DEFAULT 'remembered'
                    CHECK (proof IN ('checked', 'remembered', 'need_to_find')),
  -- The person says the title or place names a prison, jail or other facility.
  -- Each lane then shows the true title, a venue-only line, or leaves it out.
  names_facility  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_entry_user
  ON practice_entry (user_id, section, year DESC);

-- Owner only, every command (same shape as 073 / 059).
DO $$
DECLARE t text := 'practice_entry';
BEGIN
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
END $$;

DO $$
BEGIN
  REVOKE ALL ON practice_entry FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON practice_entry TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------- artifact type values --
-- 005 made the type CHECK inline, so Postgres named it
-- refinery_artifact_artifact_type_check. A CHECK that tests artifact_type
-- against a list is dropped by its definition (not only by that name; today
-- there is exactly one) and the full list is put back under the known name.
-- The new list is wider than every old one, so the validation scan (done
-- under this file's lock, a few thousand rows) cannot fail on existing rows.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'refinery_artifact'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\(artifact_type = ANY|artifact_type IN'
  LOOP
    EXECUTE format('ALTER TABLE refinery_artifact DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_artifact_type_check
  CHECK (artifact_type IN (
    'resume', 'cover_letter', 'follow_up', 'disclosure_plan',
    'interview_prep', 'resource_list', 'job_match',
    'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list'
  ));
