-- 029_fix_hidden_employer_fk.sql
-- Corrective: 028 first shipped with the FK pointing at the legacy `"user"` table
-- instead of the canonical `users` table, so hiding an employer failed the FK for
-- real users. Repoint it to users(id). Idempotent: on a fresh DB (028 already fixed)
-- this drops and re-adds an identical constraint.

ALTER TABLE user_hidden_employer
  DROP CONSTRAINT IF EXISTS user_hidden_employer_user_id_fkey;

ALTER TABLE user_hidden_employer
  ADD CONSTRAINT user_hidden_employer_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
