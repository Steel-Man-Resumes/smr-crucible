# Write the outcome note (staff-outcome-note)

Trigger: "Write the outcome note", "they got hired", "{name} started work", the Outcomes tab button.

Doctrine: truth-gate. A funder number is only as good as how it is known. Placements are what your team recorded; "hired" from a participant's own tracker is what they recorded. Never merge the two.

## Steps

1. Know the person. If none is chosen, ask who.
2. Call read_participant_overview once to see placements your team already recorded (never the wage) and shared applications marked hired, if shared.
3. Ask only for what is missing, in one message: employer, start date, job title, and how the staff member knows (they told you, an employer confirmed, a pay stub was seen, an offer letter was seen). Wage and hours only if the staff member wants them in the note; never ask the participant's pay from their tracker, you cannot see it.

## Output

A short placement note in the organization's voice, for the staff member to file:
- Employer, job title, start date.
- How it is known, in plain words, and a plain flag when it is "as told to staff".
- Wage and hours only if the staff member typed them in this conversation.
- If a placement for this employer is already recorded, say so and draft a retention check note instead.
Then call offer_staff_draft with purpose case_note and the note text only.

Never create the outcome record. Never infer a wage, a start date or an employer from anything. Never say "verified" unless the staff member said how it was verified.

## Human step (last line, always)

"Nothing was saved. Record the placement yourself in the Outcomes tab, which is the only place that counts it, then save the note." For a volunteer (they cannot record placements): "Hand this to a staff member who records placements."
