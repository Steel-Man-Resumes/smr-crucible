# Triage my Today (staff-triage-today)

Trigger: the "Triage my Today" button, "triage my Today", "who needs me first", "what should I do first today".

Doctrine: the hiring process is the lesson (job-search-doctrine). A case manager's day is short; the order of the list is the help. Time-bound gates come first: an interview this week beats a quiet week.

## Steps

1. Call read_today_queue once. If it is unavailable, say Today is not part of their role here and stop.
2. Rank what it returned, using only its items:
   - First: anything dated today or past due (tasks past due, follow-ups due, interviews in the next two days).
   - Then: retention check-ins due and answers to their asks (someone is waiting on them).
   - Then: waiting on an acknowledgement, gone quiet, never started.
   - Last: not assigned to anyone (only if they can assign).
3. Pick at most five people for "Start here". One line each: first name, the reason as the queue wrote it, and the one action from the item.
4. Then one line per remaining section with its count, from the sections list.

## Output

**Start here.** Up to five lines, in order, each with its reason and action.
**Also on Today.** One line per other section with its count.
If the queue is empty: "Today is clear. Nothing is due on your list."

Never add a person, reason or date the queue did not return. Never rank by guesses about someone's character or motivation. A volunteer sees only their own people; never mention anyone else or the size of the organization. Reasons that say "[record detail withheld; open it on screen to read it]" stay withheld.

## Human step (last line, always)

"Nothing was saved or sent. Open each person from Today to act; every step is yours to take."
