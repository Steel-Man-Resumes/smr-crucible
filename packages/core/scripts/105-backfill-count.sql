-- READ ONLY. Run before applying migration 105 to see what its backfill would
-- create: one row per organization with the number of retention check-in
-- tasks (30, 90, 180 days) it would make, how many of those would already be
-- past due, and how many would have no owner (owner and admins see those).
-- Mirrors the backfill in 105_workflow.sql: open placements (no end date, not
-- entered by mistake) that started in the last 120 days, marks with no
-- current answer. Works before 105 (no staff_task.source_* needed) and before
-- or after 102 (superseded_by is read only when it exists).
WITH placements AS (
  SELECT o.id, o.access_code_id, o.client_user_id, o.created_by, o.start_date
    FROM outcome_record o
   WHERE o.ended_on IS NULL AND COALESCE(o.end_reason, '') <> 'entered_in_error'
     AND o.start_date > current_date - 120
), marks AS (
  SELECT p.*, m AS mark, p.start_date + m AS due_on
    FROM placements p CROSS JOIN unnest(ARRAY[30, 90, 180]) m
   WHERE NOT EXISTS (SELECT 1 FROM retention_check k
                      WHERE k.outcome_id = p.id AND k.day_mark = m
                        AND (NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'retention_check'::regclass AND attname = 'superseded_by' AND NOT attisdropped)
                             OR (to_jsonb(k) ->> 'superseded_by') IS NULL))
)
SELECT m.access_code_id AS org_id,
       count(*) AS tasks_to_make,
       count(*) FILTER (WHERE m.due_on < current_date) AS already_past_due,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM client_staff_assignment a
                                           WHERE a.access_code_id = m.access_code_id AND a.client_user_id = m.client_user_id)
                          AND NOT EXISTS (SELECT 1 FROM access_code ac WHERE ac.id = m.access_code_id AND ac.partner_user_id = m.created_by)
                          AND NOT EXISTS (SELECT 1 FROM org_staff s WHERE s.access_code_id = m.access_code_id AND s.user_id = m.created_by AND s.role = 'org_admin'))
         AS likely_unassigned
  FROM marks m
 GROUP BY m.access_code_id
 ORDER BY tasks_to_make DESC;
