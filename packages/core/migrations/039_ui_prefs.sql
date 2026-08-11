-- 039_ui_prefs.sql
-- Phase 7.2 + 7.7: app-wide accessibility/display preferences and the
-- zero-PII illustrated avatar CHOICE (not an image). All additive and
-- idempotent, style-matched to 038. Prod code that predates these columns
-- reads none of them, so this is inert until the Settings UI ships.
--
-- ui_font_scale     : 'normal' | 'large' | 'xl'. NULL means normal (default).
--                     Size only -- contrast/color are untouched, so AA holds.
-- ui_reduced_motion : NULL = follow the OS (prefers-reduced-motion); true/false
--                     is an explicit user override of that OS default.
-- ui_density        : 'comfortable' | 'compact'. NULL means comfortable.
-- ui_avatar         : the illustrated-avatar CHOICE as JSONB
--                     ({ shape, color, accent, initial }). NULL means the
--                     default derived-from-initial avatar. No photo, no PII,
--                     no R2 -- the photo/AI-headshot half stays R2-gated.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_font_scale     TEXT,
  ADD COLUMN IF NOT EXISTS ui_reduced_motion BOOLEAN,
  ADD COLUMN IF NOT EXISTS ui_density        TEXT,
  ADD COLUMN IF NOT EXISTS ui_avatar         JSONB;
