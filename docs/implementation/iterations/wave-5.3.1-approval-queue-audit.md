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
feature: "5.3"
wave: "5.3.1"
agents: []
tags: [coriven, approvals, audit-log, zero-trust, security, ui, server-actions]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.3.1: Approval Queue, Audit Log & Approvals UI

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 5.3.1 |
| Feature | 5.3 — Approval Queue, Audit & Execution |
| Epic | 5 — Communications Intelligence |
| Status | Planning |
| Scope | `approval_queue` and `audit_log` tables; `submit_for_approval` chat tool; Server Actions for Approve/Modify/Cancel; `/approvals` page with `ApprovalCard` (what + why, three-way decision); append-only `audit_log` written on every state transition; tray polling endpoint for pending approvals. This wave ends at the execution boundary — execution is covered in Wave 5.3.2. |
| Wave Goal | The Approve/Modify/Cancel flow is operational end-to-end from chat tool submission through the `/approvals` UI, with every state transition recorded in an append-only `audit_log`; no external action is executed in this wave (that is the Wave 5.3.2 boundary). |

**Wave Philosophy:** One enforcement point — the queue and audit gate must be airtight before any executor is wired in Wave 5.3.2.

## Wave Goals

1. The `submit_for_approval` chat tool inserts a validated `approval_queue` row (`pending`); the payload is validated at insert time (never raw AI output or untrusted content); every insert writes a corresponding `audit_log` entry (ADR-009, UC-16).
2. The `/approvals` page renders all pending approvals as `ApprovalCard` components showing action type, what, why, and payload preview; users can Approve, Modify, or Cancel with authenticated Server Actions (Business Requirements Feature 7, UC-16, UC-27, UC-29).
3. Every state transition (`pending → approved`, `pending → cancelled`, `pending → modified`) writes an append-only `audit_log` record via service-role client; the `audit_log` table has no delete policy and no update policy (UC-37).

## User Stories

---

### Story 5.3.1.1 — `approval_queue` and `audit_log` Tables

**As the** system,
**I want** a validated `approval_queue` table and an append-only `audit_log` table,
**So that** every proposed external action is tracked and every state change is permanently recorded.

**Reference:** Business Requirements Feature 7, UC-16, UC-37; ADR-009; Architecture §"Data Model (by phase)" Comms tables.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- `approval_queue` table exists with: `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `action_type text NOT NULL`, `description text NOT NULL`, `rationale text NOT NULL`, `payload jsonb NOT NULL`, `status approval_status NOT NULL DEFAULT 'pending'`, `submitted_by text NOT NULL DEFAULT 'claude'`, `reviewed_at timestamptz`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`.
- `approval_status` enum: `pending`, `approved`, `cancelled`, `modified`, `executed`, `failed`.
- `audit_log` table exists with: `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `event_type text NOT NULL`, `entity_type text NOT NULL`, `entity_id uuid`, `payload jsonb`, `actor text NOT NULL`, `created_at timestamptz DEFAULT now()`. No `updated_at` (append-only — rows are never updated).
- RLS on `approval_queue`: `SELECT/UPDATE` — `USING (user_id = auth.uid())`; `INSERT` via service-role only (chat tool runs server-side); `DELETE` not permitted (cancelled via status update only).
- RLS on `audit_log`: `SELECT` — `USING (user_id = auth.uid())`; `INSERT` — service-role only; `UPDATE` and `DELETE` — no policy exists (blocked at the DB level).
- Both tables have `user_id` index; `approval_queue` has index on `(user_id, status)`.
- TypeScript types regenerated.

#### Task 5.3.1.1.1 — Approval Queue and Audit Log Migrations

| Field | Value |
|---|---|
| Parent Story | 5.3.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 5.1.1 (`integration_provider` enum in place) |
| Deliverables | `supabase/migrations/<timestamp>_add_approval_queue.sql`; `supabase/migrations/<timestamp>_add_audit_log.sql` |

**Acceptance Criteria:**
- Both migrations pass `supabase db push` without errors.
- `audit_log` has no `UPDATE` or `DELETE` RLS policy — verified by a test asserting that a service-role attempt to `DELETE` from `audit_log` fails with a policy violation (or that the policy simply does not exist and the table owner blocks it).
- `approval_queue` rows cannot be hard-deleted by the authenticated user (no DELETE RLS policy for `auth.uid()`).

#### Task 5.3.1.1.2 — Payload Validation Schema

| Field | Value |
|---|---|
| Parent Story | 5.3.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.3.1.1.1 |
| Deliverables | `apps/web/src/lib/approvals/payload-schemas.ts` — Zod schemas per `action_type` |

**Acceptance Criteria:**
- Zod schemas defined for each supported action type: `send_email` (`{ to, subject, body, draft_id? }`), `create_calendar_event` (`{ title, start_at, end_at, attendees?, description? }`), `cancel_calendar_event` (`{ event_id, reason? }`).
- A `validateApprovalPayload(action_type, payload)` function throws a typed `PayloadValidationError` with field-level messages on invalid input.
- Unit tests cover: valid payload per type; missing required field; unknown action_type rejected.
- No `action_type` that is not in a known allowlist can pass validation.

---

### Story 5.3.1.2 — `submit_for_approval` Chat Tool

**As the** Chat Engine (Claude),
**I want** a `submit_for_approval` tool that places a validated action proposal into the queue,
**So that** the zero-trust invariant is enforced — Claude proposes, the user decides, execution comes later.

**Reference:** Business Requirements Feature 7, UC-16, UC-27; ADR-009 §"Zero-trust spine."

**Priority:** Critical
**Estimated hours:** 12

**Acceptance Criteria:**
- `submit_for_approval` is registered in the tool registry with JSON-Schema inputs: `action_type` (string enum), `description` (string — what will happen in plain language), `rationale` (string — why based on the user's request), `payload` (object — action-specific parameters).
- The tool handler validates the payload via `validateApprovalPayload` before any DB write; if validation fails, returns an error result to Claude (no row created).
- On valid input, inserts an `approval_queue` row with `status = 'pending'` via service-role client; immediately writes an `audit_log` row: `{ event_type: 'approval_submitted', entity_type: 'approval_queue', entity_id: <new row id>, actor: 'claude', payload: { action_type, description } }`.
- The tool never includes the user's message verbatim or any external content in the `payload` field — only the structured parameters derived by Claude.
- The tool is added to `ALL_TOOL_NAMES` and `TOOL_REGISTRY`; it must be enabled in `tool_permissions` to appear in the model's tool list.
- Claude confirmation message tells the user the action is pending approval in `/approvals`.

#### Task 5.3.1.2.1 — Tool Definition and Handler

| Field | Value |
|---|---|
| Parent Story | 5.3.1.2 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.3.1.1.1, 5.3.1.1.2 |
| Deliverables | Updated `apps/web/src/lib/chat/tools/registry.ts` and `handlers.ts`; `apps/web/src/lib/approvals/approval-service.ts` |

**Acceptance Criteria:**
- `submitApproval(userId, { action_type, description, rationale, payload })` in `approval-service.ts` is the single service function called by the tool handler; it owns validation + queue insert + audit write as a logical unit (both writes in sequence; if audit write fails, log the error but do not roll back the queue row — audit failure is non-blocking).
- Tool handler in `handlers.ts` matches the established pattern (service client, typed input, `HandlerResult`).
- Integration test: call handler with valid `send_email` payload → `approval_queue` row created with `status = 'pending'`; `audit_log` row created; test with invalid payload → no rows created, error result returned.

#### Task 5.3.1.2.2 — Tool Permission Seed

| Field | Value |
|---|---|
| Parent Story | 5.3.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.3.1.2.1 |
| Deliverables | Migration or seed entry for `submit_for_approval` in `tool_permissions` |

**Acceptance Criteria:**
- `submit_for_approval` appears in `tool_permissions` with `enabled = true` by default (for the owner user); it can be toggled off in Settings > Tool Permissions like any other tool.
- The tool name string matches exactly between the registry, the handler map, and `tool_permissions`.

---

### Story 5.3.1.3 — Approve / Modify / Cancel Server Actions

**As the** owner,
**I want** Server Actions that let me approve, modify, or cancel a queued action,
**So that** every decision is authenticated, recorded in the audit log, and the queue status is updated.

**Reference:** Business Requirements Feature 7, UC-16, UC-27, UC-29, UC-37; ADR-009.

**Priority:** Critical
**Estimated hours:** 12

**Acceptance Criteria:**
- `approveAction(approvalId)` Server Action: validates authenticated session; sets `approval_queue.status = 'approved'`, `reviewed_at = now()`; writes `audit_log` row `{ event_type: 'approval_approved', entity_id: approvalId, actor: auth.uid() }`; returns the updated row.
- `modifyAndApproveAction(approvalId, updatedPayload)` Server Action: validates payload via `validateApprovalPayload`; sets `status = 'modified'`; writes audit row `{ event_type: 'approval_modified', payload: { from: oldPayload, to: updatedPayload } }`; returns updated row. (Wave 5.3.2 will then pick up `modified` rows alongside `approved` rows for execution.)
- `cancelAction(approvalId)` Server Action: sets `status = 'cancelled'`, `reviewed_at = now()`; writes audit row `{ event_type: 'approval_cancelled', actor: auth.uid() }`; nothing is executed.
- All three actions reject if `approvalId` does not belong to `auth.uid()` (RLS enforces; service-role is NOT used for these user-facing actions).
- All three actions reject if the row's current status is not `pending` (idempotency guard).
- Rejected/cancelled actions are permanently logged; no hard delete of `approval_queue` rows.

#### Task 5.3.1.3.1 — Server Actions Implementation

| Field | Value |
|---|---|
| Parent Story | 5.3.1.3 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.3.1.1.1, 5.3.1.1.2, 5.3.1.2.1 |
| Deliverables | `apps/web/src/app/actions/approvals.ts` |

**Acceptance Criteria:**
- Each action uses the `auth-server` Supabase client for the status update (RLS ensures user ownership) and the service-role client for the audit log write.
- Actions are `'use server'` functions; they revalidate the `/approvals` page path on success.
- Status guard: `if (existing.status !== 'pending') throw new Error('Action already reviewed')`.
- Error handling: DB errors are caught, logged server-side, and re-thrown as user-facing messages; no internal error detail (stack traces, SQL) is returned to the client.
- Unit tests (with mocked Supabase): approve happy path; cancel happy path; modify with invalid payload throws; non-owner attempt rejected; double-approve rejected.

#### Task 5.3.1.3.2 — Audit Log Write Service

| Field | Value |
|---|---|
| Parent Story | 5.3.1.3 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.3.1.1.1 |
| Deliverables | `apps/web/src/lib/approvals/audit-service.ts` |

**Acceptance Criteria:**
- `writeAuditLog(userId, event)` uses the service-role client exclusively; never uses the auth client.
- Function is non-blocking by design: callers do not `await` it in the critical path (write-and-forget with error logging); optionally awaited where ordering matters.
- Exported function is the single audit write entry point — no other code path writes to `audit_log` directly.
- Unit test: verify correct row shape; verify service-role client is used (not auth client) by checking the function does not depend on session context.

---

### Story 5.3.1.4 — `/approvals` Page with `ApprovalCard`

**As the** owner,
**I want** an `/approvals` page where I can review, approve, modify, or cancel pending actions,
**So that** I maintain full control over everything Coriven proposes to do in the external world.

**Reference:** Business Requirements Feature 7, UC-16; UX Doc §"Approvals" + `ApprovalCard` component spec.

**Priority:** High
**Estimated hours:** 14

**Acceptance Criteria:**
- `/approvals` lists all `approval_queue` rows with `status = 'pending'` for the authenticated user, ordered by `created_at ASC` (oldest first).
- Each item renders as an `ApprovalCard` showing: action type label, description (what), rationale (why), a collapsible payload preview ("Preview draft"), and three action buttons: Approve (primary), Modify (secondary), Cancel (destructive).
- Approve calls `approveAction`; cancel calls `cancelAction`; Modify opens an inline edit form for the payload, then calls `modifyAndApproveAction`.
- After an action, the card is removed from the list (optimistic update confirmed by revalidation).
- Empty state: "No pending approvals — Coriven will ask before doing anything."
- The `/approvals` count is surfaced in the Today/Briefing page summary (cross-links to this page).

#### Task 5.3.1.4.1 — ApprovalCard Component

| Field | Value |
|---|---|
| Parent Story | 5.3.1.4 |
| Agent | Frontend Engineer |
| Estimation | 8h |
| Dependencies | Task 5.3.1.3.1 |
| Deliverables | `apps/web/src/components/approvals/approval-card.tsx` |

**Acceptance Criteria:**
- Props match the UX doc contract: `actionType`, `description`, `rationale`, `payload`, `onApprove`, `onModify(nextPayload)`, `onCancel`.
- Modify flow: clicking Modify renders a JSON/form editor for the payload; user edits and confirms; calls `onModify` with the new payload; the card remains visible until the Server Action resolves.
- Loading state: buttons are disabled and show a spinner during the Server Action call.
- All three buttons are keyboard-reachable; Cancel has `aria-label="Cancel this action"` to distinguish from generic "Cancel"; Approve is the default focused button.
- Destructive action (Cancel) has a confirmation step (e.g., second click or confirmation dialog) to prevent accidental cancellation.

#### Task 5.3.1.4.2 — Approvals Page and Nav Integration

| Field | Value |
|---|---|
| Parent Story | 5.3.1.4 |
| Agent | Full-Stack Engineer |
| Estimation | 6h |
| Dependencies | Task 5.3.1.4.1 |
| Deliverables | `apps/web/src/app/approvals/page.tsx`; nav update |

**Acceptance Criteria:**
- `approvals/page.tsx` is a server component; fetches pending approvals via auth-server client (RLS); passes to `ApprovalCard` list; includes empty-state and count display.
- Nav link to `/approvals` shows a badge with pending count when > 0.
- Page revalidation triggered by Server Actions keeps the list current without a full page reload.
- `/api/approvals/pending` (GET, session-authenticated) returns `{ count: number, items: ApprovalRow[] }` for the Tauri tray to poll.

#### Task 5.3.1.4.3 — Tray Polling Endpoint

| Field | Value |
|---|---|
| Parent Story | 5.3.1.4 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.3.1.1.1 |
| Deliverables | `apps/web/src/app/api/approvals/pending/route.ts` |

**Acceptance Criteria:**
- `GET /api/approvals/pending` requires a valid Supabase session (auth-server client); returns 401 otherwise.
- Returns `{ count: number, items: [{ id, action_type, description, created_at }] }` — no `payload` content in the tray response (sensitive; user reviews in browser).
- The Tauri tray uses this endpoint to fire a native notification: "Action waiting for your approval — Open Coriven."
- Response is cached for no longer than 30 seconds (tray polls on its own interval).

---

## Task Dependencies

```
5.3.1.1.1 (migrations: approval_queue + audit_log)
  ├─> 5.3.1.1.2 (payload validation schemas)
  │     ├─> 5.3.1.2.1 (submit_for_approval tool handler + approval-service)
  │     │     ├─> 5.3.1.2.2 (tool_permissions seed)
  │     │     └─> 5.3.1.3.1 (Server Actions: approve/modify/cancel)
  │     │           └─> 5.3.1.4.1 (ApprovalCard component)
  │     │                 └─> 5.3.1.4.2 (approvals page + nav)
  │     └─> 5.3.1.3.2 (audit-service) — parallel with 5.3.1.2.1
  └─> 5.3.1.4.3 (tray polling endpoint) — parallel; depends only on migration
```

Critical path: migrations → payload schemas → tool + service → Server Actions → ApprovalCard → page.
Parallel: audit-service and tray endpoint can be built once the migration is applied.

## Definition of Done

- `approval_queue` and `audit_log` tables in place; `audit_log` has no update or delete RLS policy (verified by DB test).
- `submit_for_approval` tool callable from chat; validated payload required; invalid payloads return an error with no DB write.
- Every queue insert writes a corresponding `audit_log` row; every Approve/Modify/Cancel writes a corresponding `audit_log` row.
- `/approvals` page renders pending actions; all three Server Actions function correctly; acted-upon cards disappear from the list.
- `GET /api/approvals/pending` returns correct pending count; tray can display a notification badge.
- Zero-trust enforcement test: an attempt to call `submit_for_approval` with an unrecognized `action_type` is rejected (validation error, no DB write).
- Audit immutability test: assert that no HTTP path exposed by the application can delete or update a row in `audit_log`.
- WCAG AA: ApprovalCard buttons labeled; Cancel has confirmation; keyboard navigation functional.
- All env vars for this wave already in `.env.example` from prior waves (no new secrets needed in this wave).

## Infrastructure Specifications

### Database

**Tables:**

- `approval_queue` — see Story 5.3.1.1 for full column spec. `action_type` constrained to known values via Zod at application layer (not a DB enum, to allow extension without migrations).
- `audit_log` — append-only; no update or delete policy; `created_at` is the immutable timestamp.

**Enums:**

- `approval_status`: `pending`, `approved`, `cancelled`, `modified`, `executed`, `failed`.

**RLS:**

- `approval_queue`: SELECT/UPDATE `USING (user_id = auth.uid())`; INSERT service-role only; no DELETE.
- `audit_log`: SELECT `USING (user_id = auth.uid())`; INSERT service-role only; UPDATE/DELETE — no policy (effectively blocked).

**Indexes:**

- `approval_queue (user_id, status)` — `/approvals` pending query.
- `audit_log (user_id, created_at DESC)` — audit history view.

**Migrations:** `<timestamp>_add_approval_queue.sql`; `<timestamp>_add_audit_log.sql`

### API

| Method | Path | Auth | Purpose | Key Validation |
|---|---|---|---|---|
| Server Action | `approveAction(id)` | Session (auth-server) | Approve pending action | Ownership via RLS; status must be `pending` |
| Server Action | `modifyAndApproveAction(id, payload)` | Session (auth-server) | Modify payload and approve | Payload validation via Zod; ownership; status guard |
| Server Action | `cancelAction(id)` | Session (auth-server) | Cancel pending action | Ownership; status guard |
| GET | `/api/approvals/pending` | Session (auth-server) | Tray polling | 401 if unauthenticated |

**Errors:** 401 on missing session; 403 on wrong ownership (RLS); 400 on invalid payload (Zod); 409 on double-review (status guard); all errors logged server-side with no internal detail in the client response.

### UI

- `/approvals` page: server component list of pending approvals; `ApprovalCard` per item; empty state.
- `ApprovalCard` props: `actionType: string`, `description: string`, `rationale: string`, `payload: unknown`, `onApprove: () => Promise<void>`, `onModify: (next: unknown) => Promise<void>`, `onCancel: () => Promise<void>`.
- Nav badge: pending count from server component; updates on revalidation.
- Accessibility: Approve button is `type="button"` with `aria-label="Approve: send email to Sarah"`; Cancel has two-step confirmation; Modify opens `role="dialog"` with focus trap.

### Testing

- **Unit:** `approval-service.ts` (valid submit → row + audit; invalid payload → no rows); `audit-service.ts` (service-role client used; correct row shape); Server Actions (happy paths for all three; status guard; non-owner rejected).
- **Integration:** Full chat-tool-to-queue path with mocked Supabase; `submit_for_approval` with invalid `action_type` → no rows; cancel flow writes audit row.
- **Zero-trust enforcement test:** Programmatically call `submit_for_approval` handler with `action_type = 'unknown_action'`; assert no `approval_queue` row is created and the handler returns an error result.
- **Audit immutability test:** Using service-role client, attempt `DELETE FROM audit_log WHERE ...`; assert the operation fails or that the RLS setup makes it unreachable from any application code path.
- **E2E:** chat says "draft a reply to Sarah" → card appears in `/approvals` → approve → row status `approved`; cancel → row status `cancelled`.
- **Coverage target:** >85% on `approval-service.ts`, `audit-service.ts`, and Server Actions.

### Deployment

No new environment variables required for this wave (all secrets established in Wave 5.1.1 and 5.2.1).

### Monitoring

- Track: pending approval count per user (alert if > 10 pending for more than 24h — possible pipeline issue).
- Track: audit log write failure rate (should be 0%; alert on any failure).
- Track: approval throughput (approved vs cancelled ratio) — signals UX friction if cancel rate is high.
- Log every Server Action call with `{ event_type, approval_id, user_id, duration_ms, outcome }`.

## Handoff Requirements

- Migrations applied; TypeScript types regenerated.
- `submit_for_approval` tool enabled in `tool_permissions` for owner.
- ApprovalCard component reviewed for accessibility.
- Zero-trust enforcement test and audit immutability test passing in CI.
- Wave 5.3.2 (Execution Path) may begin immediately after this wave's Definition of Done is met — it depends on `status = 'approved'` rows existing and the `audit-service` being available.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Zero-trust violation: Claude constructs a payload that triggers execution without approval | Critical | Low | Hard invariant: executor (Wave 5.3.2) checks status = 'approved' before acting; zero-trust test required before Wave 5.3.2 ships |
| `audit_log` row omitted on a state transition | High | Low | `audit-service.ts` is the single write point; integration tests assert audit write on every state change |
| Modify payload allows injection of unvalidated content | High | Low | `modifyAndApproveAction` re-validates via `validateApprovalPayload`; Zod schema rejects unknown fields |
| Double-approval race (two browsers, both click Approve) | Medium | Low | Status guard (`WHERE status = 'pending'`) in the UPDATE; idempotent — second call gets 409 |

## Related Documentation

- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- ADR-009 (approval queue + audit gate): `docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md`
- Architecture §"Security invariant," §"Data Architecture": `docs/architecture/_main/04-Architecture.md`
- Business Requirements Feature 7, UC-16, UC-27, UC-29, UC-37: `docs/architecture/_main/03-Business-Requirements.md`
- UX §"Approvals," `ApprovalCard` component contract: `docs/architecture/_main/05-User-Experience.md`
- Wave 5.1.1 (prerequisite): `docs/implementation/iterations/wave-5.1.1-integrations-encrypted-tokens.md`
