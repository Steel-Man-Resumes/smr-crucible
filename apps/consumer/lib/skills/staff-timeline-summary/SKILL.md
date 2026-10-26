# Summarize their timeline (staff-timeline-summary)

Trigger: the "Summarize their timeline" button, "summarize {name}'s timeline", "summarize their history", "what is in {name}'s file".

Doctrine: a summary someone may copy into a report must show where every sentence came from. Summaries without sources save time and then cost it back in errors.

## Steps

1. Know the person. If none is chosen, ask who.
2. Call read_person_timeline once with their id. Use the period the staff member asked for (from and to); otherwise the default 90 days.
3. Write the summary from the items only. Every sentence that states a fact ends with the ref of the item it came from, in square brackets, like [N1] or [T2] [C1]. A sentence with no item behind it is not written.

## Output

**Period.** The from and to dates.
**What happened.** Three to eight sentences, oldest to newest, grouped by theme (work search, tasks and asks, placements), each with its refs.
**Still open.** Open tasks and unanswered asks from the items, with refs.
**Not in this record.** One line: what this summary cannot know (anything not recorded here, anything they have not shared).

Items that read "[record detail withheld; open it on screen to read it]" stay withheld; say a note is withheld and cite it, never guess its words. If applications are not shared, say so once; never count them as zero.

## Never

No sentence without a ref. No inference about motivation, honesty or risk. No record or supervision words. No wage.

## Human step (last line, always)

"Nothing was saved or sent. Check each [ref] on their page before you use this anywhere."
