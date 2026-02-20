# Architecture Decision Record

## ADR-001: Unified Platform (Crucible)

**Status:** Accepted
**Date:** 2026-02-20

### Context
Two existing applications (smr-forge and smr-refinery) handle career services workflows separately. This creates data silos, duplicated logic, and inconsistent user experiences.

### Decision
Replace both apps with a single unified platform (Crucible) using:
- **Next.js 14 App Router** for the web frontend (deployed to Vercel)
- **BullMQ worker** for heavy compute (deployed via Docker on VPS)
- **PostgreSQL on Neon** as the single source of truth
- **Cloudflare R2** for file/object storage
- **Event-sourced audit log** for all significant actions

### Consequences
- Single codebase, single deployment pipeline
- All state is persistent and queryable
- Event log enables analytics, debugging, and future research
- Worker isolation prevents serverless timeout issues

---

## ADR-002: Event-Sourced Audit Log

**Status:** Accepted
**Date:** 2026-02-20

### Context
Career services workflows involve sensitive PII and require auditability. We also want to enable future analytics and research capabilities.

### Decision
Every significant action emits a structured event to an append-only `event` table. Events include actor attribution, data classification, retention class, and correlation IDs.

### Consequences
- Complete audit trail for compliance
- Research-ready data with consent tracking
- Structured payloads enable automated analysis
- Storage costs scale with activity (mitigated by retention classes)

---

## ADR-003: File Storage in R2

**Status:** Accepted
**Date:** 2026-02-20

### Context
Documents (resumes, cover letters, reports) are central to the workflow. Storing binary data in PostgreSQL is inefficient and expensive.

### Decision
Store all files in Cloudflare R2 (S3-compatible). Database stores metadata and object key pointers via the `file_object` table.

### Consequences
- Cost-effective blob storage
- S3-compatible API (wide ecosystem support)
- No egress fees (R2 advantage)
- Requires managing two storage systems

---

## ADR-004: Auth.js with Email Magic Link

**Status:** Accepted
**Date:** 2026-02-20

### Context
Users need secure, passwordless authentication. The existing stack uses Resend for email delivery.

### Decision
Use Auth.js v5 with the Resend email provider for magic link authentication.

### Consequences
- No password management burden
- Familiar email-based flow for users
- Depends on email delivery reliability
- Session management handled by Auth.js
