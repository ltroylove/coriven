---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven"
epic: "5"
feature: "5.2"
wave: "5.2.1"
agents: []
tags: [coriven, email, gmail, outlook, nango, haiku, triage, cron, zero-trust]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Wave 5.2.1: Email Poll + Haiku Triage

## Wave Overview
- **Wave ID:** Wave-5.2.1
- **Feature:** Feature 5.2 - Email Triage (Gmail + Outlook)
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Scheduled polling of Gmail and Outlook for new message headers, AI batch classification of each message, metadata-only persistence, and an on-demand tool for retrieving full message bodies.
- **Wave Goal:** Every 15 minutes, new emails across a user's connected Gmail and Outlook accounts are classified for urgency and category with a one-line summary — with no email bodies ever stored.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. New messages from both Gmail and Outlook are detected within one polling cycle (15 minutes) for every user with a connected account, using tokens retrieved exclusively through the integration authority (Nango) — never from Coriven's database.
2. Each new message receives an urgency level, a category, and a one-line summary from a Haiku batch classification, stored as metadata only.
3. Re-polling the same messages never creates duplicates — ingestion is idempotent.
4. Full message bodies remain retrievable on demand, treated as untrusted content, and are never persisted.

## User Stories

### User Story 1: Email metadata is stored safely and privately

**As a** Coriven user with a connected email account
**I want** only the metadata of my emails (sender, subject, timestamps, classification) stored by Coriven
**So that** my email content stays private and my data is isolated from other users.

**Acceptance Criteria:**
- [ ] A metadata record exists per message with provider, message identity, thread identity, sender, subject, received time, urgency, category, one-line summary, and read state — and no body content.
- [ ] Records are visible only to the owning user; another user can never read them.
- [ ] Ingesting the same message twice for the same user and provider results in exactly one record.
- [ ] Urgency and category are constrained to the defined value sets (urgency: critical, high, normal, low; category: important, action_required, informational, promotional, spam).

**Priority:** High

---

### User Story 2: New email is detected automatically from both providers

**As a** Coriven user
**I want** Coriven to notice new email in my Gmail and Outlook accounts within 15 minutes of arrival
**So that** urgent messages surface without me opening either inbox.

**Acceptance Criteria:**
- [ ] A scheduled job runs every 15 minutes and processes every user with at least one connected email provider.
- [ ] New message headers are fetched from Gmail and from Outlook; only messages not yet seen are processed.
- [ ] Provider access tokens are obtained per call from the integration authority; no token is read from or written to Coriven's database.
- [ ] The scheduled endpoint rejects any caller that does not present the cron secret, using a timing-safe comparison.
- [ ] A failure for one user or one provider does not stop polling for other users or the other provider.

**Priority:** High

---

### User Story 3: New email is classified by urgency and category with a summary

**As a** Coriven user
**I want** each new email classified (urgency, category) with a one-line summary
**So that** I can see at a glance what needs my attention without reading everything.

**Acceptance Criteria:**
- [ ] Each polled batch of new messages is classified in a single Haiku model call per user rather than one call per message.
- [ ] Classification input is limited to metadata and headers (sender, subject); body content is not sent to the model during triage.
- [ ] Every stored record has a non-empty urgency, category, and one-line summary.
- [ ] A classification failure falls back to safe defaults (normal urgency, informational category) rather than dropping the message.

**Priority:** High

---

### User Story 4: Email bodies are available on demand, never stored

**As a** Coriven user chatting with the assistant
**I want** the assistant able to pull up the full content of a specific email thread when I ask
**So that** I get detail when I need it without Coriven warehousing my email content.

**Acceptance Criteria:**
- [ ] The assistant has a tool that fetches a specific thread's messages live from the provider given a thread reference.
- [ ] Fetched body content is framed as untrusted, hostile content before any model sees it — instructions inside an email can never be executed as commands.
- [ ] Body content is returned for the current interaction only and is never written to the database.
- [ ] The tool only returns threads belonging to the requesting user's own connected accounts.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Cron endpoint rejects unauthenticated callers
- **Endpoint:** `/api/cron/email-poll`
- **Method:** GET
- **Test Data:** Request with missing, empty, and incorrect `Authorization` bearer values
- **Expected Result:** 401 in all three cases; no polling side effects
- **Verification:** No provider calls made; no rows written to `email_metadata`

### Test Case 2: Poll ingests and classifies new messages
- **Endpoint:** `/api/cron/email-poll`
- **Method:** GET (valid `CRON_SECRET`)
- **Test Data:** Mocked Gmail + Graph responses with 3 new message headers each; mocked Haiku batch response
- **Expected Result:** 200; 6 rows inserted for the test user with urgency, category, and summary populated
- **Verification:** Row count, enum values within allowed sets, `ai_summary` non-empty, no body column present

### Test Case 3: Re-poll is idempotent
- **Endpoint:** `/api/cron/email-poll`
- **Method:** GET (valid `CRON_SECRET`, same mocked provider responses as Test Case 2)
- **Expected Result:** 200; zero new rows
- **Verification:** Total row count unchanged after second run

### Test Case 4: On-demand thread fetch stores nothing
- **Endpoint:** Chat tool-dispatch path invoking `get_email_thread`
- **Method:** POST (chat API)
- **Test Data:** Thread reference for a seeded metadata row; mocked provider body response
- **Expected Result:** Tool result contains thread messages wrapped in hostile-content framing
- **Verification:** No new columns/rows containing body text; response scoped to requesting user

## Technical Tasks

### Task 1: `email_metadata` schema migration
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (Feature 5.1 `integrations` table already live)
- **Priority:** High

**Deliverables:**
- `supabase/migrations/<timestamp>_email_metadata.sql` — table with `id`, `user_id`, `provider`, `message_id`, `thread_id`, `from_address`, `subject`, `received_at`, `urgency` enum (`critical|high|normal|low`), `category` enum (`important|action_required|informational|promotional|spam`), `ai_summary text`, `is_read boolean`, `created_at`; `UNIQUE(user_id, provider, message_id)`; RLS policies; indexes on `(user_id, received_at DESC)` and `(user_id, urgency)`
- Regenerated `apps/web/src/types/supabase.ts`
- Shared email types exported from `packages/types`

**Acceptance Criteria:**
- [ ] Migration applies cleanly; unique constraint enforces idempotency; RLS verified per user
- [ ] Typecheck passes with regenerated types

---

### Task 2: Provider header-fetch clients (Gmail + Microsoft Graph)
- **Agent:** backend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/email/gmail.ts` and `apps/web/src/lib/email/outlook.ts` — list new message IDs + headers since a checkpoint, normalized to a common shape
- Both clients obtain tokens via the Feature 5.1 `nango.getToken()` wrapper per call

**Acceptance Criteria:**
- [ ] Both providers return a normalized header record (message id, thread id, from, subject, received time)
- [ ] No token values touch Coriven's database or logs; per-provider errors are isolated and logged

---

### Task 3: Haiku batch triage classifier
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/email/triage.ts` — batches normalized headers into a single `claude-haiku-4-5-20251001` call per user, returning urgency/category/summary per message with strict output validation

**Acceptance Criteria:**
- [ ] Output validated against the enum sets; invalid or missing classifications fall back to `normal`/`informational`
- [ ] Only headers/metadata are sent to the model — no bodies

---

### Task 4: Cron poll route
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Tasks 2, 3
- **Priority:** High

**Deliverables:**
- `apps/web/src/app/api/cron/email-poll/route.ts` — GET handler: `CRON_SECRET` check via `crypto.timingSafeEqual`, iterate connected users, fetch → triage → upsert (`ON CONFLICT DO NOTHING` on the unique key)
- `vercel.json` cron entry (`*/15 * * * *`)

**Acceptance Criteria:**
- [ ] Unauthenticated requests get 401; per-user/per-provider failures don't abort the run
- [ ] Re-runs insert zero duplicates

---

### Task 5: `get_email_thread` tool
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- Tool handler + registration in the existing tool-dispatch loop; on-demand body fetch from the correct provider with hostile-content framing applied to all returned body text
- `ToolName` union extended in `packages/types`

**Acceptance Criteria:**
- [ ] Bodies fetched live, framed as untrusted, never persisted; scoped to the requesting user

---

### Task 6: Wave test suite
- **Agent:** quality-control
- **Estimation:** 6 hours
- **Dependencies:** Tasks 4, 5
- **Priority:** High

**Deliverables:**
- Unit tests for provider clients (mocked APIs) and triage validation/fallbacks
- Integration tests covering the four Logical Unit Test Cases above

**Acceptance Criteria:**
- [ ] All test cases pass; idempotency and auth rejection proven by test, not inspection

## Task Dependencies

```
Task 1 (schema migration)
  ↓
Task 2 (provider clients)
  ├─> Task 3 (Haiku triage) ──> Task 4 (cron route) ─┐
  └─> Task 5 (get_email_thread tool) ────────────────┤
                                                     ↓
                                          Task 6 (test suite)
```

**Critical path:** Task 1 → Task 2 → Task 3 → Task 4 → Task 6. Task 5 runs parallel to Task 3/4 after Task 2.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3, Task 4, Task 5 | 29 |
| quality-control | Task 6 | 6 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (auth rejection, ingest + classify, idempotency, no-body-storage)
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors (strict mode)
- [ ] Security review: no tokens in DB or logs; hostile-content framing verified on body fetch
- [ ] Documentation updated (`.env.example`, epic doc wave status)
- [ ] Deployed to production with cron schedule active

## Infrastructure Specifications

### Database

**New table `email_metadata`** (`user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`):

| Column | Type |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL` |
| `provider` | `text NOT NULL` (`'gmail'` / `'outlook'`) |
| `message_id` | `text NOT NULL` |
| `thread_id` | `text` |
| `from_address` | `text` |
| `subject` | `text` |
| `received_at` | `timestamptz` |
| `urgency` | `email_urgency` enum: `critical`, `high`, `normal`, `low` |
| `category` | `email_category` enum: `important`, `action_required`, `informational`, `promotional`, `spam` |
| `ai_summary` | `text` |
| `is_read` | `boolean DEFAULT false` |
| `created_at` | `timestamptz DEFAULT now()` |

**Constraints/indexes:** `UNIQUE(user_id, provider, message_id)`; index `(user_id, received_at DESC)`; index `(user_id, urgency)`. **No body column — ever.**

**RLS:** enabled; user policies `USING (user_id = auth.uid())`; service-role writes from the cron path.

### API

- `GET /api/cron/email-poll` — Vercel Cron only. Auth: `Authorization: Bearer <CRON_SECRET>` compared with `crypto.timingSafeEqual`; 401 otherwise. Returns per-run summary counts (users processed, messages ingested, failures) — no message content.
- Gmail read scope `gmail.readonly`; Microsoft Graph `Mail.Read` (already granted in Feature 5.1 connect flow).
- Tool: `get_email_thread(provider, thread_id)` — server-side only, dispatched through the existing chat tool loop.

### UI

No UI changes in this wave (inbox UI is Wave 5.2.2).

### Testing

- Unit: provider clients (mocked HTTP), triage output validation and fallbacks, cron auth guard.
- Integration: full poll cycle against mocked providers + local Supabase; idempotency on re-run; RLS cross-user isolation; tool fetch persists nothing.

### Deployment

| Variable | Scope | Purpose |
|---|---|---|
| `CRON_SECRET` | Server-only | Authenticate Vercel Cron invocations (may already exist from prior cron waves — verify) |
| `NANGO_SECRET_KEY` / `NANGO_HOST` | Server-only | Already introduced in Feature 5.1 — required at runtime here |

`vercel.json`: add `{ "path": "/api/cron/email-poll", "schedule": "*/15 * * * *" }`.

### Monitoring

- Structured log per run: users processed, new messages per provider, triage batch latency/token counts, per-provider error codes. Never log subjects, senders, or bodies at error level without redaction.
- Haiku cost visibility: log input/output token counts per triage batch.

## Handoff Requirements

**For next wave (5.2.2):**
- `email_metadata` populated and queryable per user with urgency/category/summary
- `get_email_thread` tool callable for on-demand body display
- Shared email types available from `packages/types`

**For other Features/Epics:**
- Feature 5.4 (meeting prep) reads `email_metadata` for related-email assembly
- Epic 6 / daily briefing pulls overnight `critical`/`high` items from `email_metadata`

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Gmail/Graph API quota or verification limits during dev | Med | Test accounts; per-user backoff; provider failures isolated per run |
| Triage inaccuracy on headers-only input | Med | Safe fallbacks; categories user-visible in 5.2.2 where re-classification can be added later |
| Cron run exceeds serverless duration with many users/messages | Med | Cap messages per user per run; carry checkpoint forward to next run |
| Nango unavailable at poll time | Med | Skip run gracefully, log, retry next cycle — no partial writes without classification |

## Notes and Assumptions

- Feature 5.1 is complete: `integrations` rows exist with `nango_connection_id` per user/provider and the server-side `nango.getToken()` wrapper is available.
- Polling checkpoint strategy (history ID / delta link vs. last `received_at`) is an implementation choice inside Task 2; either must guarantee no missed messages between runs.
- All email content — including subjects during triage — is treated as untrusted data, never as instructions.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.2)
- ADR-013: docs/architecture/decisions/ADR-013-integration-token-authority.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9.3, §11.1)

## Wave Retrospective

{This section will be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
