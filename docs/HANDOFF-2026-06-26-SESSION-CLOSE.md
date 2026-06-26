# SMR Crucible -- Session Close 2026-06-26

## What happened this session

Single focused task: onboarding My Way Out as a new SMR partner prospect.

**MWOCREW access code -- LIVE**
- Inserted directly into Neon (production DB) via targeted seed script.
- Code: `MWOCREW` | Tier: `client` | Daily limit: 200 AI calls | Max redemptions: 10 seats
- DB row id: `a9986f48-8b08-49d5-a33d-ac21bb74d5e2`
- Access link: `forge.steelmanresumes.com/access?code=MWOCREW`

**Display name wired**
- `apps/consumer/app/access/page.tsx` -- added `MWOCREW: "My Way Out"` to PARTNER_NAMES.
- Committed `32f9a35` + deployed via `git push origin main`.
- When Ruben/Nadiyah open the link, the welcome page greets them as "My Way Out."

**Seed script**
- `packages/core/scripts/seed-mwocrew.ts` -- created, run, left as documentation of the insert.
  Not committed (ephemeral). Can delete.

## Who is My Way Out

- mwout.org, ~5 years old, ~1,000 justice-impacted people served
- Model: 6-10 week pre-release skills training + 5-week trade micro-credentials + 3 years wraparound
- Their "Building the Path to Success" includes resume development + mock interviewing
- **Fit: high** -- their employment training lane maps directly to Forge + Refinery
- Contacts: Karen J. Coy-Romano (President/CFO/Board, the initiator), Ruben Gaona (ED, decision-maker), Dr. Nadiyah Johnson (VP Ops)

## Next for this repo

No pending builds from this session. The next smr-crucible session should pick up from
HANDOFF-2026-06-10-FABLE-SESSION-CLOSE.md (the 24-task board in BUILD-CHECKLIST.md).

If/when My Way Out partnership formalizes, they may want:
- Provider dashboard access for their staff
- Participant outcome reporting for their funders
