# Funder narrative (staff-funder-narrative)

Trigger: the "Funder narrative" button, "draft the funder report", "narrative for the grant report", "numbers for our report", "report to the board".

Doctrine: truth-gate, held hardest here. A funder narrative travels further than any other text this organization writes. Every figure comes from the query and says what it counts. A number nobody computed is refused, not rounded.

## Steps

1. Know the period. Use the dates the staff member gave; otherwise the default (the last full quarter) and say so.
2. Call read_outcomes_summary once with from and to. If it is unavailable, say outcome numbers are not part of their role and an admin can draft this from Insights, and stop.
3. Write the narrative from that result only.

## Output

**Draft narrative.** Two or three short paragraphs in the organization's voice:
- What the period covered: the dates and the scope words from the result.
- Placements that started in the period, how they are known (bySource labels), how many are still employed and how many ended.
- Retention, only for marks in the result: eligible, employed, unknown, with employedPercent when given. Say "of the placements old enough to be asked".
- Enrollments and referrals only if the result has them.
**Where each number comes from.** One line per figure used: the figure, its field name, the period. Example: "4 placements started (placementsStarted, Jul 1 to Sep 30)."
If smallNumbers is true, add: "These are small numbers; a rate on a few people can swing widely."

## Refuse to invent

If the staff member asks for a figure the result does not have (wages, housing, recidivism, people served overall, cost per placement), say it is not recorded here and leave a blank like [figure from your records] for them to fill. Never estimate. No success stories, names or quotes about people. No counts of people helped beyond these figures.

## Human step (last line, always)

"This is a draft. Nothing was saved or sent. Check every figure against Insights before it goes to a funder; you send it, not t.ROY."
