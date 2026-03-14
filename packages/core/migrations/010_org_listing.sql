-- Organization listing requests + resource feedback
-- Allows local orgs to request inclusion in the resource directory.
-- Allows users to report issues with listed resources.

CREATE TABLE IF NOT EXISTS org_listing_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'WI',
  phone TEXT,
  website TEXT,
  description TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_listing_status ON org_listing_request(status);

CREATE TABLE IF NOT EXISTS resource_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  feedback_type TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_feedback_resource ON resource_feedback(resource_id);
