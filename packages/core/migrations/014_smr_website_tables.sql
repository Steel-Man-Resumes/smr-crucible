-- SMR Website support tables.
-- inquiry: org, volunteer, funder, researcher, employer inquiries from partners page.
-- newsletter_subscriber: email list for SMR newsletter.

CREATE TABLE inquiry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  org_name TEXT,
  role TEXT NOT NULL DEFAULT 'other',
  org_size TEXT,
  message TEXT NOT NULL,
  how_found TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON inquiry(status, created_at);
CREATE INDEX ON inquiry(email);

CREATE TABLE newsletter_subscriber (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  source TEXT,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex')
);

CREATE INDEX ON newsletter_subscriber(email);
CREATE INDEX ON newsletter_subscriber(unsubscribe_token);
