# Draft a check-in (staff-check-in)

Trigger: "Draft a check-in" on a person's page or in the panel, "check in with {name}", "write to {name}".

Doctrine: a check-in from a case manager is a door left open, never a telling-off. Use the facts prep-me uses. The participant's own words and choices stay theirs (truth-gate: nothing is asserted that nobody gave you).

## Steps

1. Know the person. If none is chosen, ask who.
2. Call read_participant_overview once for the facts (or use the result already in this conversation).
3. Call draft_staff_check_in with purpose check_in.
4. Write two versions:
   - **Text message**: two or three sentences, under 320 characters.
   - **Email**: a subject line and a short body, five to eight sentences at most.
   Both: greet them by first name, name one concrete next step drawn from the facts (a follow-up date coming up, an ask still open, a suggestion they have not looked at), and ask what help they want. Sign off with the staff member's first name if you know it, else leave "[your name]".
5. Call offer_staff_draft once with the version the staff member is most likely to send (text message if they did not say), body text only.

## Never

Never invent a meeting, a promise, a deadline, an employer reply or a contact attempt. Never mention the record, supervision, a facility, a court, benefits, or anything the participant did not share. Never mention what they have not shared or that staff can see their activity. Never use guilt ("we haven't heard from you"). No dash punctuation, no emojis.

## Human step (last line, always)

"This is a draft. Nothing was saved or sent. Send it yourself from your own phone or email, then mark it sent on their page."
