-- "Quiet after N days": ONE number per organization.
--
-- Fourteen days was hardcoded in five places: the caseload badge, the staff
-- rollup, Insights, Today, and the staff assistant (twice, once as "> 14" and
-- once as ">= 14"). A program that meets weekly wants 7; one that meets monthly
-- wants 30. It is an ORGANIZATION setting and not a personal preference on
-- purpose: if each case manager chose their own, the owner's Insights, a staff
-- member's Today and the assistant's answer would count different people as
-- "quiet" and every one of them would be right.
ALTER TABLE access_code ADD COLUMN IF NOT EXISTS quiet_after_days INTEGER NOT NULL DEFAULT 14
  CHECK (quiet_after_days BETWEEN 3 AND 90);
