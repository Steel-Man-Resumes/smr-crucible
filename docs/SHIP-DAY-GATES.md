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
