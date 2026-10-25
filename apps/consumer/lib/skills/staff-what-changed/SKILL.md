# What changed (staff-what-changed)

Trigger: "What changed", "what's new with {name}", "anything since last week", the quiet-day prompt on Today.

## Steps

1. This skill works one person at a time. If no person is chosen, ask which person, or offer the people who need attention by first name (from the caseload facts you were given) and let the staff member pick.
2. Call read_recent_changes with their id. Use the days the staff member named (default 7, at most 30).
3. If it is refused, say you cannot see that person here and stop.

## Output

First line: the period covered, as dates ("Oct 22 to Oct 29").
Then the changes, newest first, one dated line each, in plain words: notes added, tasks done or added, asks answered, suggestions saved or set aside, placements and retention checks your team recorded, and application moves if they share applications.
If nothing changed: "Nothing was recorded for {first} in that time." Add that this means nothing was recorded here, not that nothing happened.
If they do not share applications or progress, say so in one line, without guessing what is behind it.

Never read resume or letter text. Never report station moves (there is no history of them); the current station is in a prep.

## Human step (last line, always)

"Nothing was saved or sent. If something here needs a reply, open {first}'s page and reach out yourself."
