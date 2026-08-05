# HANDOFF 2026-08-05 — Org admin-invite feature (BUILT 2026-08-05 evening, see HANDOFF.md; deploy gated on Troy) + Baker email fix (DONE)

Session focus: Troy disliked the "share this weird link" line in the GOE Trendsetters
onboarding email to Dr. Baker. Investigating it surfaced a real product gap. Troy chose
"send the honest current-flow email now, build the invite feature next." He is closing
this session and will do the build in a NEW session. This is that handoff.

---

## DONE this session (no code changed, no deploy)

1. **Dr. Baker onboarding email fixed** — Gmail draft `r2480427624251027758`
   (subject "Your GOE Trendsetters access to the Forge and the Refinery",
   to latonyabakergoe@gmail.com). Draft only, NOT sent (standing rule).
   - Removed the `/access?code=BAKERCREW` link entirely.
   - "How your participants join" now describes the truthful current flow: share code
     BAKERCREW; participant self-signs-up at forge.steelmanresumes.com and enters the
     code ("Have a partner code?") or adds it in Settings; non-coded people self-signup
     unaffiliated; 10 seats, ask for more.
   - Collapsed the two identical walkthrough links down to one:
     `forge.steelmanresumes.com/walkthrough`.

2. **Memory written** (todash memory store): `project-smr-org-admin-invite-feature.md`
   and `project-smr-walkthrough-three-asset-plan.md`, both pointered in MEMORY.md.

---

## VERIFIED findings — how org-join actually works today (read before building)

There is **NO admin-invite feature**. The org leader dashboard's only write action is
reassigning an already-joined participant to a staff member.

- Leader dashboard: `apps/consumer/components/org/OrgDashboard.tsx`, route
  `/dashboard/partner` (a partner-tier org admin also lands here from `/dashboard` —
  `apps/consumer/app/(dashboard)/dashboard/page.tsx` ~257-271). Backend
  `apps/consumer/app/api/partner/org/route.ts` POST handles only `action: "assign"`;
  anything else → 400 "Unknown action". No email send, no account creation.
- The ONLY join path is the access code, self-redeemed, three entry points:
  - `/access?code=XYZ` (`apps/consumer/app/access/page.tsx`) sets a 60-day
    `smr_access_code` cookie; `POST /api/auth/register` reads THAT COOKIE only
    (`accessCodeFromCookie`, register route ~190-197) → `ensureUserAttribution`.
    NOTE: register does NOT read a typed code from its body.
  - Login "Have a partner code?" field → `localStorage.pending_access_code`
    (`login/page.tsx` storeCode ~70) → auto-redeemed on Refinery dashboard load
    (`RefineryShell.tsx` ~242-251 → `POST /api/access-code/redeem`).
  - `/dashboard/settings` "Partner Access Code" form → `/api/access-code/redeem`.
- Codes minted admin-only: `POST /api/admin/access-code/mint`. Core:
  `packages/core/src/accessCode.ts` `redeemAccessCode` (seat/max_redemptions aware),
  `packages/core/src/partnerTracking.ts` `ensureUserAttribution`.
- Staff seeding pattern (the model for pre-provisioning): `scripts/seed-goe-org.mjs`
  — creates accounts with "no password, no invite sent," signs in via magic link.
  GOE = org "GOE Trendsetters", admin latonyabakergoe@gmail.com, code BAKERCREW,
  Baker is in `PARTNER_PRE_AUTH` in `apps/consumer/auth.ts`.

---

## PENDING BUILD — admin invite by name (Troy authorized "build next"; NOT started)

Goal: org admin enters a participant's **name + email** on the leader dashboard, the app
sends them an invitation, and they join already attributed to the org — so the admin
never has to pass around a code or link.

Recommended v1 (reuses existing machinery, no new token system):
- Add an "Add participant" form to `OrgDashboard.tsx` (name + email).
- New action on `POST /api/partner/org` (e.g. `action: "invite"`) — org-admin-gated —
  that: (a) checks the org's remaining seats (respect `max_redemptions` on the code /
  cohort), (b) pre-provisions a client account attributed to the org (mirror
  `seed-goe-org.mjs`: create user, attribute via `ensureUserAttribution` or a direct
  redemption), (c) sends a magic-link welcome via Resend (the app already uses the
  `resend` NextAuth provider for magic links — reuse that sender/branding).
- Invited-but-not-yet-active people should surface as **pending** on the dashboard
  (the cohort table + counts already distinguish joined vs pending — wire the new row in).
- Seat limit: block with a clear message when full; admin asks Troy to raise it.

### Design fork to confirm with Troy before/while building
- **Pre-create the account** (shows as pending immediately, matches how Baker's own
  account was set up) — RECOMMENDED — vs. just email a join link and only create the
  row when they act. Recommend pre-create for dashboard visibility + consistency.
- Invite email copy/branding: pull from SMR brand bible (SMR = "Truth. Told Strong.");
  do not invent taglines. Confirm sender identity/address with Troy.

### GATE — this is the LIVE shared SMR product
Used by multiple real orgs (GOE/BAKERCREW, 5 Star/5STARCREW, JFW, EXPO, My Way Out,
Guest House, OFS). Build it, verify locally, and SHOW TROY BEFORE DEPLOYING. Do not push
to prod blind. (Aligns with the "gate before new infrastructure" standing rule.)

### Verify before done
Follow the "silent email failure" doctrine: confirm the invite email actually DELIVERS
(check Resend delivery), and confirm an invited user lands attributed to the org — don't
trust an API 200.

---

## Also on Troy's plate (his own work, ~2026-08-06) — do NOT build unless asked
Three walkthrough assets to replace the two identical placeholders:
1 platform-level **demo** (Forge + Refinery as one platform) + 2 per-app **walkthroughs**
(Forge-only, Refinery-only). See memory `project-smr-walkthrough-three-asset-plan.md`.
Until they exist, client emails link only `forge.steelmanresumes.com/walkthrough`.

## Git / deploy state
No code changed this session → nothing to commit in smr-crucible from this work (this
handoff doc is the only new file). todash had PRE-EXISTING uncommitted/modified files at
session start that are NOT from this session — left untouched. No deploys.
