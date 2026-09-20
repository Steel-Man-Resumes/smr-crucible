-- How each staff member likes to work, and their organization's defaults.
--
-- One JSONB column each, because this is a bag of small independent choices
-- that will grow (columns shown, sort order, default note type ...), and a
-- column per choice would mean a migration per checkbox. The SHAPE is owned by
-- TypeScript (staffPrefsShared.ts): every read is normalized against an
-- allowlist, so an unknown key or a bad value in a row is dropped, never
-- honored -- the same rule as capabilities and sharing scopes.
--
-- Preferences only ever change how a person's OWN screen is arranged. Nothing
-- here can widen what anyone is allowed to see.
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE access_code ADD COLUMN IF NOT EXISTS staff_pref_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;
