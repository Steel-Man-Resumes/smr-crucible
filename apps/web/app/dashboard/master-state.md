# Crucible — Master State

## Done
- **Phase 0–2**: Foundation, auth, upload, v1 pipeline (extract → parse → analyze → generate resume)
- **Phase 3A**: v2 Stage A pipeline — 10-step sequential core (extract, parse, signals, JSearch jobs, employer tiers, Perplexity enrichment, salary, resources, plan, bundle init)
- **Phase 3B**: 11 generators (resume, 3 cover letters, employers battleplan, action plan, interview prep, salary negotiation, alloy report, portfolio HTML, tracker XLSX, quickstart, readme) + Stage C assembly (manifest, ZIP, status)
- **Hardening**: JSON control-char sanitization, repair pipeline, Stage C partial completion, BullMQ idempotency, failure recording

## Works Now
- Upload resume → v2 pipeline → 13 parallel artifacts → ZIP bundle → download
- 10/13 artifacts succeeded on first real test (Nicholas Vicich, food service, Waukesha WI)
- v1 single-resume pipeline still works
- Dev auth bypass, signed URL downloads, human review (approve/reject)

## Broken / Fragile
- `gen_employers`, `gen_actionplan`, `gen_salary` — intermittent JSON parse failures on large outputs
- Perplexity enrichment JSON occasionally malformed (non-fatal, pipeline continues)
- No user intake form — output based solely on resume text extraction

## Next Up
1. **Phase 3C**: Manifest-driven dashboard (sections, status badges, portfolio preview, ZIP download, Stage B progress)
2. **Phase 4**: User intake form during Stage A wait (target city, dream roles, salary goals, barriers, preferences)
3. **Phase 5**: Production deploy (Docker worker on VPS, Vercel web, Stripe)
