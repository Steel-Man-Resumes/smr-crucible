-- Org staff hierarchy (EXPO build-out, Troy 2026-08-02, roster confirmed).
-- An org is anchored by its access_code (e.g. EXPO2026). The code OWNER
-- (partner_user_id) stays the top-level signal; org_staff adds the people
-- working under it: org admins (Marianne) and staff (Miranda, Kelly).
-- client_staff_assignment maps cohort clients to the staff member who works
-- with them. Consent gating for what staff can SEE is unchanged -- these
-- tables only model who is responsible for whom.

CREATE TABLE IF NOT EXISTS org_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('org_admin', 'staff')),
  title TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (access_code_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_staff_user ON org_staff(user_id);

CREATE TABLE IF NOT EXISTS client_staff_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (access_code_id, client_user_id)
);
CREATE INDEX IF NOT EXISTS idx_csa_staff ON client_staff_assignment(staff_user_id);

-- Org branding on the anchor code (real logos only -- doctrine)
ALTER TABLE access_code ADD COLUMN IF NOT EXISTS org_logo_url TEXT;
