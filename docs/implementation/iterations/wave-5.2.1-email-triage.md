---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.2"
wave: "5.2.1"
agents: []
tags: [coriven, email, triage, haiku, cron, gmail, inbox, privacy]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.2.1: Email Triage

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 5.2.1 |
| Feature | 5.2 — Email Triage |
| Epic | 5 — Communications Intelligence |
| Status | Planning |
| Scope | Vercel Cron polls Gmail every 15 minutes for new message IDs and headers (no bodies fetched during poll); Haiku batch-classifies urgency, action-item flag, and one-line summary; results stored in `email_metadata` (body never stored); `/email` inbox page displays the triaged inbox with urgency filter; email body fetched on demand only. |
| Wave Goal | New Gmail messages appear classified by urgency in the `/email` inbox within 15 minutes of arrival; no email body is ever written to the database; email bodies are fetched from Gmail only on explicit user request. |

**Wave Philosophy:** Privacy by design — the system stores the minimum (headers + AI classification); the body lives only in transit on demand.

## Wave Goals

1. The Gmail poll cron runs on a 15-minute schedule, fetches only message IDs and headers for new messages, and stores triage classifications in `email_metadata` within 15 minutes of email arrival (Business Requirements Feature 6, UC-31).
2. Haiku batch-classifies urgency (`critical` / `high` / `normal` / `low`), `has_action_item` (boolean), and `one_line_summary` (string) per email; no email body is ever written to `email_metadata` or any other table (Architecture §"Data Protection").
3. The `/email` page renders the triaged inbox with urgency badges, action-item flags, and summaries; email bodies are fetched live from Gmail only when the user opens a thread (UC-32).

## User Stories

---

### Story 5.2.1.1 — Gmail Poll Cron (Headers Only, No Body)

**As the** Email-Triage Cron actor,
**I want** to poll Gmail every 15 minutes for new message IDs and headers,
**So that** new emails are detected and queued for classification without storing any message body.

**Reference:** Business Requirements Feature 6, UC-31; Architecture §"Cron Jobs."

**Priority:** Critical
**Estimated hours:** 14

**Acceptance Criteria:**
- A Vercel Cron job fires every 15 minutes, protected by `CRON_SECRET` header validation; unauthenticated requests receive 401.
- The cron fetches Gmail message IDs since the last poll watermark (stored per user in `integrations` or a dedicated column) using only the `list` and `get` (metadata format) Gmail API endpoints — the `full` or `raw` format is never requested.
- For each new message ID not already in `email_metadata (user_id, provider, provider_message_id)`, a row is inserted with headers only: `subject`, `from_address`, `to_addresses`, `received_at`, `thread_id`, `labels`. The `body_snippet` field is left null.
- The cron is idempotent: if a message ID already exists in `email_metadata`, it is skipped without error.
- Token refresh (`ensureFreshToken`) is called before each Gmail API request; if the integration is `needs_reauth`, the cron skips that user and logs the event without throwing.
- Structured log entries (no token values, no body content) are written on cron start, per-user success count, and any API errors.

#### Task 5.2.1.1.1 — `email_metadata` Table Migration

| Field | Value |
|---|---|
| Parent Story | 5.2.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 5.1.1 (integrations table in place) |
| Deliverables | `supabase/migrations/<timestamp>_add_email_metadata_table.sql` |

**Acceptance Criteria:**
- Migration creates `email_urgency` enum: `critical`, `high`, `normal`, `low`.
- Creates `email_metadata` table: `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `provider integration_provider NOT NULL`, `provider_message_id text NOT NULL`, `thread_id text`, `subject text`, `from_address text`, `to_addresses text[]`, `received_at timestamptz`, `labels text[]`, `urgency email_urgency`, `has_action_item boolean`, `one_line_summary text`, `triage_completed_at timestamptz`, `created_at timestamptz DEFAULT now()`.
- Unique constraint on `(user_id, provider, provider_message_id)`.
- RLS: `SELECT/INSERT/UPDATE` policy `USING (user_id = auth.uid())`; service-role used for cron inserts.
- Index on `(user_id, received_at DESC)` for inbox list queries.
- No `body`, `body_snippet`, or `raw_content` column exists — by design.
- TypeScript types regenerated.

#### Task 5.2.1.1.2 — Gmail Client Service

| Field | Value |
|---|---|
| Parent Story | 5.2.1.1 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Wave 5.1.1 token refresh service (`ensureFreshToken`) |
| Deliverables | `apps/web/src/lib/integrations/gmail-client.ts` |

**Acceptance Criteria:**
- Exports `listNewMessageIds(userId, sinceTimestamp)` — calls Gmail `users.messages.list` with `q: 'after:<timestamp>'`; returns `string[]` of message IDs.
- Exports `getMessageHeaders(userId, messageId)` — calls Gmail `users.messages.get` with `format=metadata` and `metadataHeaders=['Subject','From','To','Date']`; returns a typed object with no body fields.
- Both functions call `ensureFreshToken` before making API requests and propagate `IntegrationAuthError` to callers.
- No function in this module requests `format=full` or `format=raw`; a lint comment `// INVARIANT: no body` is present at the top of the file.
- Unit tests with mocked Google API responses cover: new messages found; no new messages (empty list); auth error propagation.

#### Task 5.2.1.1.3 — Poll Cron Route

| Field | Value |
|---|---|
| Parent Story | 5.2.1.1 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.2.1.1.1, 5.2.1.1.2 |
| Deliverables | `apps/web/src/app/api/cron/email-poll/route.ts`; `apps/web/src/lib/jobs/email-poll.ts` |

**Acceptance Criteria:**
- Route validates `Authorization: Bearer ${CRON_SECRET}` header; returns 401 otherwise.
- Job iterates all users with an active Gmail integration; for each, calls `listNewMessageIds` then `getMessageHeaders` per new message, and upserts into `email_metadata` (skipping on conflict).
- Poll watermark (last fetched timestamp) is stored as `integrations.last_poll_at timestamptz` (requires a migration add-column or a separate `integration_metadata` jsonb column — choose one and document).
- On `IntegrationAuthError`, sets `integrations.status = 'needs_reauth'` and continues to next user.
- Returns `{ processed: n, skipped: n, errors: n }` JSON on success; 500 on unhandled error.
- Vercel `vercel.json` cron schedule: `"*/15 * * * *"` for this route.

---

### Story 5.2.1.2 — Haiku Batch Triage Classification

**As the** Email-Triage Cron actor,
**I want** Claude Haiku to classify each new email's urgency, action-item flag, and one-line summary from its headers,
**So that** the user sees structured triage without reading every email manually, and without any body content stored in Coriven.

**Reference:** Business Requirements Feature 6, UC-31; Architecture §"AI Architecture" (model routing — Haiku for triage).

**Priority:** Critical
**Estimated hours:** 12

**Acceptance Criteria:**
- A `triageEmails(userId, emailMetadataIds[])` function calls Haiku with a structured prompt containing only the subject, sender, received timestamp, and labels for each email — never the body.
- Haiku returns for each email: `urgency` (one of `critical` | `high` | `normal` | `low`), `has_action_item` (boolean), `one_line_summary` (string, ≤120 chars).
- Classification results are written back to `email_metadata` fields (`urgency`, `has_action_item`, `one_line_summary`, `triage_completed_at`) via service-role client.
- Haiku is called in batches (≤20 emails per call) to stay within token limits; batch size is configurable via env var or constant.
- On Haiku API failure for a batch, the batch is marked with `urgency = 'normal'` and `one_line_summary = '[triage unavailable]'` so the inbox still renders; error is logged.
- The `ANTHROPIC_API_KEY` is read from env; model ID `claude-haiku-4-5-20251001` is the designated extraction model (Architecture Appendix C); model ID is not hardcoded as a magic string in business logic — use a named constant.

#### Task 5.2.1.2.1 — Triage Service

| Field | Value |
|---|---|
| Parent Story | 5.2.1.2 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Task 5.2.1.1.1 (email_metadata table); existing Anthropic SDK usage pattern from chat engine |
| Deliverables | `apps/web/src/lib/jobs/email-triage.ts` |

**Acceptance Criteria:**
- Prompt instructs Haiku to produce JSON array with `{ id, urgency, has_action_item, one_line_summary }` per email; prompt is structured so body content is architecturally impossible to inject (only header fields are templated in).
- JSON output is parsed with a schema validator (e.g., Zod); malformed entries fall back to `normal` urgency.
- `triage_completed_at` is set to `now()` on successful classification.
- Unit tests: valid Haiku response parsed correctly; partial failure (one bad JSON entry) handled gracefully; API error triggers the fallback.

#### Task 5.2.1.2.2 — Integrate Triage into Poll Cron

| Field | Value |
|---|---|
| Parent Story | 5.2.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Tasks 5.2.1.1.3, 5.2.1.2.1 |
| Deliverables | Updated `apps/web/src/lib/jobs/email-poll.ts` |

**Acceptance Criteria:**
- After inserting new `email_metadata` rows, the poll job calls `triageEmails` with the new IDs.
- The full poll-then-triage cycle completes within the 15-minute cron window for a reasonable inbox volume (<200 new emails per user).
- Poll log entries report triage success/failure counts alongside header-fetch counts.

---

### Story 5.2.1.3 — On-Demand Email Body Fetch

**As the** owner,
**I want** to read the full body of an email when I click into a thread,
**So that** I can see email content without Coriven ever storing it.

**Reference:** Business Requirements UC-32; Architecture §"Data Protection" (no body stored).

**Priority:** High
**Estimated hours:** 8

**Acceptance Criteria:**
- An API route `GET /api/email/thread/[threadId]` authenticates the user, retrieves the Gmail integration token via `ensureFreshToken`, fetches the thread with `format=full` from Gmail, and returns the decoded body content in the response.
- The body content is streamed/returned to the client but never written to the database.
- The route enforces that the thread's messages belong to the authenticated user's Gmail account (cross-user fetch is rejected).
- Response is scoped to subject, sender, received_at, and body text (HTML sanitized or plain text); raw MIME parts are not exposed.

#### Task 5.2.1.3.1 — Thread Fetch API Route

| Field | Value |
|---|---|
| Parent Story | 5.2.1.3 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Task 5.2.1.1.2 (Gmail client); Wave 5.1.1 token refresh |
| Deliverables | `apps/web/src/app/api/email/thread/[threadId]/route.ts`; `apps/web/src/lib/integrations/gmail-client.ts` (add `getThread`) |

**Acceptance Criteria:**
- `getThread(userId, threadId)` calls `users.threads.get` with `format=full`; extracts and decodes base64url body parts; returns `{ subject, from, received_at, body_html, body_text }`.
- Route validates the session; looks up the `email_metadata` row by `thread_id` and `user_id` to confirm the thread belongs to this user before calling Gmail.
- No body field is written to any Supabase table during the request.
- Integration test: thread fetch returns decoded content; no Supabase insert is made during the request.

---

### Story 5.2.1.4 — Triaged Inbox UI (`/email`)

**As the** owner,
**I want** a `/email` page that shows my emails triaged by urgency with action-item flags,
**So that** I can triage my inbox quickly and take action on what matters.

**Reference:** Business Requirements Feature 6; UX Doc §"Email" (triaged inbox); UC-31, UC-32.

**Priority:** High
**Estimated hours:** 12

**Acceptance Criteria:**
- `/email` displays a list of emails from `email_metadata` ordered by `received_at DESC`, grouped or filterable by urgency (`critical` / `high` / `normal` / `low`).
- Each email row shows: urgency badge (color-coded), action-item indicator, sender, subject, one-line summary, and received time.
- Clicking a row opens the thread detail (inline or modal) which calls `/api/email/thread/[threadId]` and renders the body.
- When no emails exist, a helpful empty state is shown ("No emails yet — Gmail will be polled within 15 minutes of connecting").
- Urgency filter tabs are keyboard-accessible; selected tab has `aria-selected="true"`; urgency badge colors meet WCAG AA contrast.
- Page uses server components for the list; body panel is a client component (fetches on demand).

#### Task 5.2.1.4.1 — Email Inbox Page

| Field | Value |
|---|---|
| Parent Story | 5.2.1.4 |
| Agent | Full-Stack Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.2.1.1.1, 5.2.1.3.1 |
| Deliverables | `apps/web/src/app/email/page.tsx`; `apps/web/src/components/email/email-row.tsx`; `apps/web/src/components/email/thread-panel.tsx` |

**Acceptance Criteria:**
- `email/page.tsx` is a server component; queries `email_metadata` via auth-server client (RLS enforces user isolation); passes data to client components.
- `email-row.tsx` renders urgency badge, action-item icon, subject, summary, received time; no body content.
- `thread-panel.tsx` fetches body on mount via `GET /api/email/thread/[threadId]`; shows loading skeleton while fetching; shows error state on failure.
- Urgency filter implemented as tab bar above list; updates the displayed subset client-side.
- Nav link to `/email` added to the main navigation.

#### Task 5.2.1.4.2 — Accessibility and Empty States

| Field | Value |
|---|---|
| Parent Story | 5.2.1.4 |
| Agent | Frontend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.2.1.4.1 |
| Deliverables | Updates to inbox page and components |

**Acceptance Criteria:**
- Urgency tab bar: `role="tablist"`, each tab `role="tab"`, panel `role="tabpanel"` with `aria-labelledby`.
- Urgency color badges have non-color differentiation (icon or label) so the distinction is clear without color alone.
- Empty state renders when `email_metadata` returns zero rows for the user.
- Thread panel: loading state uses a `role="status"` live region; error state has a visible retry button.
- Keyboard: Tab navigates to each email row; Enter/Space opens the thread panel.

---

## Task Dependencies

```
Wave 5.1.1 (integrations + token refresh)
  └─> 5.2.1.1.1 (email_metadata migration)
        ├─> 5.2.1.1.2 (Gmail client)
        │     ├─> 5.2.1.1.3 (poll cron route)
        │     │     └─> 5.2.1.2.2 (integrate triage into cron)
        │     └─> 5.2.1.3.1 (thread fetch route)
        │           └─> 5.2.1.4.1 (inbox page)
        │                 └─> 5.2.1.4.2 (a11y + empty states)
        └─> 5.2.1.2.1 (triage service)
              └─> 5.2.1.2.2 (integrate triage into cron)
```

Critical path: migration → Gmail client → poll cron → triage service integration → inbox page.
Parallel: thread-fetch route and triage service can be developed in parallel once the Gmail client exists.

## Definition of Done

- Gmail poll cron fires on 15-minute schedule; new emails appear in `email_metadata` within 15 minutes of arrival.
- No body content is written to any Supabase table at any point during polling or triage.
- Haiku triage classifications (`urgency`, `has_action_item`, `one_line_summary`) are populated for each new email; fallback `normal` applied on Haiku failure.
- `/email` page renders triaged inbox with urgency filter; thread body loads on demand from Gmail.
- Cron route returns 401 on missing/wrong `CRON_SECRET`; all cron routes document the secret requirement in `.env.example`.
- Unit tests pass for Gmail client (no-body invariant), triage service (parse, fallback, batch), and poll job (idempotency).
- WCAG AA: urgency badges accessible without color alone; tab navigation functional.
- `vercel.json` cron entry for `*/15 * * * *` schedule is present and tested in a preview environment.

## Infrastructure Specifications

### Database

**Tables:**

- `email_metadata` — `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `provider integration_provider NOT NULL`, `provider_message_id text NOT NULL`, `thread_id text`, `subject text`, `from_address text`, `to_addresses text[]`, `received_at timestamptz`, `labels text[]`, `urgency email_urgency`, `has_action_item boolean`, `one_line_summary text`, `triage_completed_at timestamptz`, `created_at timestamptz DEFAULT now()`. **No body column.**

**Enums:**

- `email_urgency`: `critical`, `high`, `normal`, `low`.

**RLS:**

- `SELECT/INSERT/UPDATE`: `USING (user_id = auth.uid())`; service-role for cron inserts.

**Indexes:**

- `(user_id, received_at DESC)` — inbox list.
- `(user_id, provider, provider_message_id)` UNIQUE — idempotency.
- `(user_id, thread_id)` — thread fetch validation.

**Migration:** `supabase/migrations/<timestamp>_add_email_metadata_table.sql`

### API

| Method | Path | Auth | Purpose | Key Validation |
|---|---|---|---|---|
| POST | `/api/cron/email-poll` | `CRON_SECRET` header | Poll Gmail, insert metadata, run triage | Bearer token match; 401 on mismatch |
| GET | `/api/email/thread/[threadId]` | Session (auth-server) | Fetch thread body from Gmail on demand | Authenticated; thread owned by user (checked via email_metadata row) |

**Cron schedule:** `vercel.json` entry: `{ "path": "/api/cron/email-poll", "schedule": "*/15 * * * *" }`.

### UI

- `/email` — server-component inbox list; urgency filter tabs; thread panel client component.
- Urgency badge props: `urgency: 'critical' | 'high' | 'normal' | 'low'`; renders color + text label.
- Thread panel state: `idle` → `loading` → `loaded | error`; no body persisted in component state beyond render.

### Testing

- **Unit:** `gmail-client.ts` — no-body invariant (assert `format=metadata` in mock call); `email-triage.ts` — valid parse, partial failure, API error fallback; `email-poll.ts` — idempotency (duplicate message IDs skipped).
- **Integration:** Poll cron route with mocked Gmail API; assert `email_metadata` rows created; assert no body field written; assert 401 on bad `CRON_SECRET`.
- **Zero-trust triage test:** assert that the triage prompt constructed by `triageEmails` contains no field beyond subject, from, date, and labels — verified by inspecting the prompt string in a unit test.
- **E2E:** end-to-end with a test Gmail account (optional in CI; required for acceptance sign-off).
- **Coverage target:** >80% on `email-poll.ts` and `email-triage.ts`.

### Deployment

**Additional environment variables (add to `.env.example`):**

- `CRON_SECRET` — shared secret for cron route authorization; generate with `openssl rand -hex 32`; server-only.
- `ANTHROPIC_API_KEY` — already in use from Epic 1; confirm it is set in Vercel production environment.

**`vercel.json` cron configuration:** Add `"crons": [{ "path": "/api/cron/email-poll", "schedule": "*/15 * * * *" }]`; confirm Vercel plan supports cron (Pro plan required for sub-hourly schedules).

### Monitoring

- Structured log per cron run: `{ event: 'email_poll', user_id, new_messages, triaged, skipped, errors, duration_ms }`.
- Alert if cron fails 2+ consecutive runs (Vercel function error rate).
- Track: triage completion rate (% of emails with non-null `urgency`); triage latency (avg `triage_completed_at - received_at`).
- AI cost: log Haiku token usage per batch; set a spend alert if daily triage cost exceeds a threshold.

## Handoff Requirements

- `email_metadata` migration applied; types regenerated.
- `vercel.json` updated with cron entry; cron tested in preview environment.
- `.env.example` updated with `CRON_SECRET`.
- Triage service and poll job unit tests passing in CI.
- Wave 5.3.1 (Approval Queue) may begin once `email_metadata` table exists; `submit_for_approval` tool needed before email drafting works end-to-end.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Vercel Pro plan required for 15-min cron (Hobby plan = hourly minimum) | High | High | Confirm plan tier before wave starts; upgrade if needed |
| Google OAuth app not yet verified — Gmail scopes require verification for production | High | Medium | Use test accounts during development; start verification in Wave 5.1.1 |
| Haiku triage cost on large inboxes | Medium | Medium | Batch size cap (20 emails/call); only triage new messages (not historical backfill unless opted in) |
| Body accidentally stored via misconfigured format | High | Low | `// INVARIANT: no body` comment + unit test asserting `format=metadata` in API call |

## Related Documentation

- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- Architecture §"AI Architecture" (model routing), §"Cron Jobs", §"Data Protection": `docs/architecture/_main/04-Architecture.md`
- Business Requirements Feature 6, UC-31, UC-32: `docs/architecture/_main/03-Business-Requirements.md`
- UX §"Email": `docs/architecture/_main/05-User-Experience.md`
- Wave 5.1.1 (prerequisite): `docs/implementation/iterations/wave-5.1.1-integrations-encrypted-tokens.md`
