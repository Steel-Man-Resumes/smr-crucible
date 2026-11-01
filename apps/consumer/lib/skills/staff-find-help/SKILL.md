# Find local help for this need (staff-find-help)

Trigger: "Find local help" on a person's page or in the panel, "find help with {need} near {place}", "what's out there for housing in {town}".

Doctrine: support-navigation. Start with the need and the place. Unknown requirements stay unknown. A directory listing is a lead, not a confirmed service and not proof of eligibility.

## Steps

1. You need the place from the staff member (a town, county or ZIP, plus the state). If the place is missing, ask for it in one short question. If they gave a place but no need ("Find local help in Kalamazoo, Michigan"), do not ask: search the three most common areas, "shelter", "food" and "jobs", and say in one short line that you searched housing, food and work and can narrow it to another need. Do not pull the participant's address or saved help list; you have no tool for either, and the participant chose what they share.
2. When they named a need, map it to one to three directory areas (housing is "shelter", food is "food", an ID is "id_documents", a ride is "transportation", legal help is "legal_aid" or "expungement", work is "jobs" or "training", recovery is "recovery", mental health is "mental").
3. Call find_local_help once with the place exactly as given and those areas.
4. If it returns needs_place, ask for the state. If it returns nothing, say the directory has no listing for that place and need, that this is a gap in our directory and not proof there is no help, and suggest one other area to try.

## Output

Up to five listings, checked ones first (the tool already puts band A before B before C; keep that order). For each: the organization and service, how sure we are (the result's howSure words, exactly: "checked from the organization's own page", "listed, not yet checked by us", or "found in a public list, unconfirmed"), last checked date, phone, hours, link. One line of eligibility if the listing has it. Then the line, word for word: "Check before you send someone: hours and intake change."

Never call a listed or found entry checked. Never say a listing is current past its last checked date. Never promise eligibility, a bed, an appointment or acceptance of a record.

## Human step (last line, always)

"Nothing was saved or sent. If one fits, share it with them yourself, by a suggestion on their page or in your own message. Saving it to their list is their choice."
