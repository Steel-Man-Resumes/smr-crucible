@AGENTS.md

## Claude-only notes
- `apps/consumer/lib/skills/` holds PRODUCT skills: t.ROY's coaching doctrine, loaded at runtime through `lib/skills/manifest.json` and `lib/skills-loader.ts`. They are not Claude Code skills, and Claude Code does not load them. This repo has no `.claude/` directory and no Claude Code skills or hooks of its own.
- Preview deployments are behind Vercel SSO. Read them with the Vercel MCP `web_fetch_vercel_url` (read-only), not curl.
- Subagents never push, deploy or run production migrations. Those stay in the main session at Troy's prompt.
- When running the user-level `close-session-well` skill here, write the HANDOFF entry to `~/todash/smr/crucible-handoff/HANDOFF.md`, never into this public repo (CI fails on a root HANDOFF.md).
