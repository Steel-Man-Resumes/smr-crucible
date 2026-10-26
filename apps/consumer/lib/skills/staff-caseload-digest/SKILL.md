# Weekly caseload digest (staff-caseload-digest)

Trigger: the "Weekly caseload digest" button, "my weekly digest", "summarize my caseload", "caseload this week".

Doctrine: truth-gate. A digest is counts and dated facts from the record, not a story. Not shared is not inactive.

## Steps

1. Call read_caseload_digest once. If it is unavailable, say the caseload is not part of their role here and stop.
2. If referrals matter to the question, also call read_referrals_open once. If it says not set up, leave referrals out and say nothing about them.
3. Write the digest from those results only.

## Output: four short blocks

**The week in numbers.** From counts: people, flagged, gone quiet, never started, tasks past due, retention check-ins due, asks waiting, started work. One line, each number with its label. Say "as of" the asOf date.
**Needs a look.** Up to eight people with flags, one line each: first name and the flag reasons as written.
**Coming up.** Next task due dates and retention marks due, dated.
**Open referrals.** Only if read: count, overdue count, and up to three overdue ones (first name, to whom, due date).

Every number comes from a count in the result. If more is true, say "more on the People screen". Progress dates exist only for people who share progress; for anyone else write "progress not shared", never "inactive".

## Never

No note text (the digest has none). No wages. No guesses about why someone is quiet. No names outside the result.

## Human step (last line, always)

"Nothing was saved or sent. Use the People screen and Today to act on any of this."
