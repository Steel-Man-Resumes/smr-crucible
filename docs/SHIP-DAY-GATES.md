# Ship day: the gates

Internal note. The owner sets every switch below in the hosting settings for
the Production environment; code and agents never change them. Every change
there is a deploy and needs the owner's approval.

## 1. Forge sign-in wall (decided 2026-10-10: up on ship day)

The wall is a build-time switch. `FORGE_SIGN_IN_STARTS_AT` in
`apps/consumer/lib/forge-access.ts` stays `null`; the switch raises the wall.

Before ship day:
1. Record the baseline usage numbers (read only).
2. Get the public-site copy that drops "no account needed" ready to publish
   the same day.

On ship day, in the Production environment only:
1. Set `NEXT_PUBLIC_FORGE_SIGN_IN_WALL=on`.
2. Set `SMR_RELEASE_REQUIRES_ACCOUNTS=1`.
3. Deploy. Every `next build` starts with the release check
   (`apps/consumer/lib/release-check.mjs`). With step 2 set, the build stops
   unless the wall switch reads `on`. An unreadable value in any switch it
   knows (`SMR_RELEASE_REQUIRES_ACCOUNTS`, `NEXT_PUBLIC_FORGE_SIGN_IN_WALL`,
   `PREMIUM_GATE`, `RECORD_CHECK_ENABLED`) also stops the build.
4. Check it: the build log has a `[release-check] passed` block that says
   `accounts required: yes` and `Forge sign-in wall switch: on`.
5. Signed out, open `/welcome` on the production host: it must send you to
   sign-in and back. A signed-out POST to a Forge API (for example
   `/api/forge/save`) must get 401.
6. Publish the site copy.

Run the check by hand at any time:

    SMR_RELEASE_REQUIRES_ACCOUNTS=1 NEXT_PUBLIC_FORGE_SIGN_IN_WALL=on \
      npm run release:check -w apps/consumer

Preview stays open unless the owner decides otherwise: leave both variables
unset there.

Emergency: `NEXT_PUBLIC_FORGE_SIGN_IN_WALL=off` takes the wall down, but the
release check refuses it while `SMR_RELEASE_REQUIRES_ACCOUNTS=1` is set. Set
that to `0` too, on purpose, and redeploy.

## 2. Premium split (decided 2026-10-10: Codex's split at launch)

Free with an account: the resume, support search, and text interview
practice (`TEXT_PRACTICE_SESSIONS_PER_DAY`, 5 a day, in
`apps/consumer/lib/premium.ts`). Sponsored (an organization's code or an
admin grant): voice interview coaching and one-click apply. A sponsor also
lifts the daily text practice limit. Locked tools say what is included and
how to get access, and never show a price.

The switch is `PREMIUM_GATE` (server, read at run time). Off by default:
everything stays open and the allowance does not apply.

To turn it on:
1. Confirm migration 079 is applied on Production.
2. Set `PREMIUM_GATE=on` in Production and deploy.
3. `GET /api/health/premium` must return 200 `{"ok":true,"gate":true,"ready":true}`.
   503 means the entitlement tables are missing. The sponsored tools then
   answer "temporarily unavailable" (they never open by accident). Fix the
   migration, or set the gate back to `off`.

## 3. Record check (decided 2026-10-10: off until its public copy ships)

`RECORD_CHECK_ENABLED` (server, read per request), off by default.

While off:
- `POST /api/record-check`, and GET and POST on `/api/record-check/consent`
  and `/api/record-check/saved`, answer 404 before sign-in or limits.
- The two DELETE routes stay open so a person can always take back their yes
  or delete one saved checklist (owner only, same-origin JSON, staff refused).
- `/dashboard/record-check` is a 404.
- Saved checklists (if any) still come with a data export and go with a data
  delete.

Every place in this app that describes the record check, and is hidden while
it is off:
1. `/security` and `/dashboard/security` (`components/SecurityContent.tsx`):
   the "only screen that asks for your offense" line, "saved record checks"
   in the sharing list, and the technical paragraph with the retention
   wording (30 days, up to 2 years for flagged content).
2. Settings, "How we handle your data": the record check line.
3. The disclosure planner's entry card.
4. The partner page FAQ ("What data do you collect on my clients?").
5. t.ROY: the privacy answer on the Story page, the pointer on the
   disclosure planner, and the record check page block.
6. The coaching skill `strong-background-professional` (points there only
   when t.ROY's page instructions say it is available).

Left visible on purpose: the "Saved record checks" box in Settings' data
export (data rights).

Outside this app, the same wording must ship the same day: the privacy page
on steelmanresumes.com, the partner FAQ, the public site and funder answers.
They must match `apps/consumer/lib/record-check/copy.ts`. Then set
`RECORD_CHECK_ENABLED=on` in Production and redeploy (the host applies a
settings change to new deployments only).
