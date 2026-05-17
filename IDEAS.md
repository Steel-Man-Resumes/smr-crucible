# SMR Crucible — Ideas Backlog

Drop ideas here as they come. No commitment, no structure required.
When something graduates to real work, move it to a section heading or delete it.

---

## Client Path / Onboarding
- Welcome screen after first magic-link login (celebrate the moment)
- Toast notification on successful code redemption ("Partner access unlocked!")
- Error feedback if code is invalid
- Show partner code field by default when `?code=` param present
- Skeleton loaders on dashboard while Forge data loads from DB
- "Syncing your Forge results..." indicator during localStorage→DB transfer

## Refinery — Persistent Workspace (3/1 conversation)
- Document layer: consumer_document table, save/load/version per user
- Resume persists after building — come back and adjust for specific opportunities
- Tool session persistence: each tool remembers where you left off
- Dashboard reflects real state ("1 resume saved, 3 interview sessions, disclosure not started")
- Opportunity-driven workflows: find job → tailor resume → practice interview → track app
- Opus gets context from all stored docs + tool history ("I see you updated your resume last week...")
- Forge output = seed data, Refinery grows from there over months

## Opus / AI Assistant
-

## Pipeline / Artifacts
-

## Design / UX
-

## Business / Access Model
- Forge stays free, no auth, multi-path (client/partner/observer)
- Refinery is auth-gated, per-client, long-term engagement
- Both live in same app, same deploy — route groups keep them separate
- OG apps stay live until new build is ready to swap in
- Custom domain when ready (subdomain or path model off main site)

## Infrastructure / DevOps
-

---

*Format: just dump the idea. One line is fine. Add context if you want. Date it if you care.*
