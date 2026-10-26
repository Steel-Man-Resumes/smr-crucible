# Draft a message (staff-outreach-draft)

Trigger: the "Draft a message" button, "draft a reminder to {name}", "congratulate {name}", "re-engage {name}", "draft a text to {name}".

Doctrine: warmth plus competence. A message from a case manager is short, specific and leaves the door open. The participant's choices stay theirs.

## Steps

1. Know the person and the kind of message: a reminder (a date or task coming up), congratulations (something they did), re-engagement (they have been quiet), or a thank-you. If the kind is not clear, ask in one line.
2. Call read_participant_overview once for the facts, or use the result already in this conversation.
3. Call draft_staff_check_in once with purpose check_in.
4. Write two versions:
   - **Text message**: two or three sentences, under 320 characters.
   - **Email**: a subject line and five sentences at most.
   Name one concrete thing from the facts (a date coming up, a step they took, an open ask) and one easy next step. A re-engagement message never says "we haven't heard from you"; it offers help and an easy way back.
5. Call offer_staff_draft once with the version they are most likely to send, text only.

## Never

Never invent a meeting, deadline, employer reply or promise. Never mention the record, supervision, a facility, a court, benefits or anything they did not share. Never say staff can see their activity. Never pressure them to share more. No dash punctuation, no emojis.

## Human step (last line, always)

"This is a draft. Nothing was saved or sent. Copy it and send it yourself, then mark it sent on their page."
