---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-07-02T00:00:00"
version: "2.0"
type: epic
status: Planning
domain: implementation
product:
  - "coriven"
epic: "5"
priority: "Medium"
branch: "epic/5-communications-intelligence"
architecture: ["ADR-009", "ADR-013"]
tags: [coriven, email, calendar, approvals, audit, nango, zapier-embed]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Epic 5: Communications Intelligence

## Epic Overview
- **Epic ID:** Epic-5
- **Status:** Planning
- **Duration:** Large
- **Team:** Solo (owner/developer)
- **Priority:** Medium (high-value, but later; introduces external actions + security spine)

## Problem Statement

Email and calendar are where time is lost and where trust is tested. This Epic gives Coriven email triage that saves real time and calendar awareness — and, critically, proves the trust model: every external-world action (sending email, creating events, posting to Slack) passes through an **approval queue** with an immutable **audit log**, and untrusted content can never directly trigger an action (zero-trust spine). See blueprint §9, §11.

Beyond email, this Epic also lays the foundation for connecting all of a user's life to Coriven — fitness trackers, banking, smart home, productivity tools, and more — via Zapier Embed's 6,000+ connector ecosystem. The integration architecture (ADR-013) is designed multi-tenant from day one so it scales directly into productization.

## Goals and Success Criteria

Coriven triages email accurately, surfaces what needs action, drafts replies, and executes external actions only after explicit human approval — with full auditability. Users can connect any app their life runs on.

**Success Metrics:**
- Connect Gmail via Nango → new emails classified (urgency, action item, one-line summary) within 15 minutes; no bodies stored.
- Connect Outlook via Nango alongside Gmail with no additional OAuth implementation.
- "Draft a reply to Sarah declining tomorrow" → draft lands in `/approvals` → approve → sent → status `executed`.
- A meeting-prep brief fires 15 minutes before an event.
- Untrusted email saying "schedule a meeting" never auto-acts (zero-trust verified by explicit test).
- Every recommendation/approval/execution recorded in `audit_log` (append-only).
- User connects a long-tail app (e.g. Slack) via Zapier Embed → approved action executes via Zapier webhook.

## Integration Architecture (ADR-013)

Three-layer model — all designed multi-tenant from day one:

| Layer | Tool | Responsibility |
|-------|------|---------------|
| OAuth authority | **Nango** | All provider OAuth flows + token storage + refresh. Coriven stores only `nango_connection_id` — no raw tokens in DB. |
| Deep integrations | **Direct provider APIs** | Gmail, Outlook, Google Calendar — read path (poll/fetch) and write path (approved actions). Token fetched from Nango server-side per call. |
| Long-tail connectors | **Zapier Embed** | 6,000+ apps (fitness, banking, smart home, Slack, Notion, etc.) surfaced in Coriven's settings UI. Approved actions fire a typed webhook to Zapier for execution. |

All execution paths write to `audit_log`. Refresh tokens never leave Nango.

## Scope

### In Scope
- **Tables:** `integrations` (`nango_connection_id` + `provider` + `user_id` — no raw tokens), `email_metadata` (no body stored), `calendar_events`, `approval_queue`, `audit_log`.
- **Nango:** self-hosted instance; OAuth connect/disconnect UI for Gmail, Outlook, and Google Calendar in `/settings/integrations`.
- **Email:** Gmail + Outlook poll every 15 min via Vercel Cron; Haiku batch triage; `/email` inbox view.
- **Approvals:** `submit_for_approval` → `/approvals` (Approve/Modify/Cancel) → execute → `audit_log`.
- **Calendar:** hourly sync; meeting-prep brief 15 min before event; nightly follow-up detection.
- **Zapier Embed:** connect/disconnect UI for long-tail apps in `/settings/integrations`; webhook execution path for approved long-tail actions.
- **Zero-trust enforcement:** untrusted content (email bodies, calendar descriptions) sandboxed — never passed to Claude as instructions.

### Out of Scope
- IMAP/SMTP for non-OAuth providers (Yahoo, etc.) — not worth the complexity.
- Nango Cloud (self-hosted for validation; Cloud decision deferred to productization).
- Zapier pricing/tier validation at scale (validated during productization planning).
- Fallback handling for Zapier outages beyond retry (Phase 6).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 5.1: Nango Integration & Provider Connect UI
- **Scope:** Stand up self-hosted Nango; OAuth connect/disconnect flows for Gmail, Outlook, and Google Calendar; `integrations` table (`nango_connection_id`, `provider`, `user_id`, `scopes`, `connected_at`); server-side `nango.getToken()` wrapper used by all subsequent features.
- **Key Technical Approach:** Nango self-hosted (Docker or Railway); Nango SDK on the server (`@nangohq/node`); connect flow triggered from `/settings/integrations`; `integrations` table stores only the connection ID — no raw tokens, no encryption key to manage. Minimum OAuth scopes per provider: Gmail (`gmail.readonly`, `gmail.send`), Outlook (`Mail.Read`, `Mail.Send`), Google Calendar (`calendar.readonly`, `calendar.events`). See ADR-013.
- **Requirements:** Business Requirements §"Integration Requirements," UC-17/UC-35; security NFRs.
- **Dependencies:** Epic 1 (deploy + secrets).
- **Wave Planning:** Nango setup + DB wave → connect/disconnect UI wave.

### Feature 5.2: Email Triage (Gmail + Outlook)
- **Scope:** Poll Gmail and Outlook every 15 min for new message IDs + headers; Haiku batch classifies urgency/action-item/one-line summary; store metadata in `email_metadata` (no body); `/email` inbox view with categories and urgency indicators.
- **Key Technical Approach:** Vercel Cron → `nango.getToken()` → fetch headers from Gmail API + Microsoft Graph → Haiku triage batch → `email_metadata` (UNIQUE on `user_id`/`provider`/`message_id`). Bodies fetched on demand only via `get_email_thread` tool. See blueprint §11.1.
- **Requirements:** Business Requirements Feature 6, UC-31/UC-32.
- **Dependencies:** Feature 5.1.
- **Wave Planning:** Poll + triage wave → inbox UI wave.

### Feature 5.3: Approval Queue, Audit & Execution
- **Scope:** `submit_for_approval` tool → `approval_queue` (validated payload, typed `action_type`); `/approvals` UI with Approve/Modify/Cancel; on approve — execute via direct provider API (deep integrations) or Zapier webhook (long-tail) → write `audit_log`; zero-trust enforcement tested explicitly.
- **Key Technical Approach:** Server Action validates approval, writes append-only `audit_log` (service-role only), then routes execution: deep provider → `nango.getToken()` → direct API call; long-tail → POST typed webhook to Zapier Embed endpoint (authenticated via `X-Webhook-Secret`). Invariant: `untrusted input → propose → approve → execute`. See ADR-009, ADR-013 §Security, blueprint §9.
- **Requirements:** Business Requirements Feature 7, UC-16/UC-27/UC-29/UC-37; business rules (truth ownership, approval gate).
- **Dependencies:** Feature 5.1; soft: Epic 3 (constraints can gate sends).
- **Wave Planning:** Queue + audit wave → execution routing wave → zero-trust test wave.

### Feature 5.4: Calendar Intelligence, Meeting Prep & Follow-Up
- **Scope:** Hourly calendar sync to `calendar_events`; meeting-prep brief assembled 15 min before each event (from related emails + tasks + memories + entity profiles); nightly follow-up detection (threads where user sent last message >3 days ago, no reply). Calendar writes (create/update event) through the approval queue.
- **Key Technical Approach:** Vercel Crons in `lib/jobs/`; meeting prep is deterministic assembly (ADR-008 pattern) — cross-context pull from `email_metadata`, `tasks`, `memories`, `entity_profiles`. `nango.getToken()` for Google Calendar + Outlook Calendar API calls. Calendar write actions go through Feature 5.3 approval queue. See blueprint §11.3–§11.5.
- **Requirements:** Business Requirements Feature 6, UC-33/UC-41.
- **Dependencies:** Features 5.1–5.3; Epic 2 (memory enriches prep).
- **Wave Planning:** Calendar sync wave → meeting-prep wave → follow-up detection wave.

### Feature 5.5: Zapier Embed — Long-Tail Connectors
- **Scope:** Zapier Embed white-label UI in `/settings/integrations` for users to connect any of 6,000+ apps; webhook execution path in the approval queue for long-tail approved actions; `integration_type` column on `integrations` distinguishing `nango` vs `zapier` connections; Zapier action catalog surfaced to Claude as available tool targets.
- **Key Technical Approach:** Zapier Embed SDK in `/settings/integrations`; Coriven stores Zapier connection metadata (no credentials — Zapier owns those); approved long-tail actions POST a typed webhook payload to Zapier's authenticated endpoint; Zapier confirms execution via webhook response; result written to `audit_log`. See ADR-013 §Layer 3.
- **Requirements:** "Connect all of life" vision (ADR-013); long-tail action execution.
- **Dependencies:** Feature 5.3 (approval queue must be live before Zapier execution path).
- **Wave Planning:** Zapier Embed setup + connect UI wave → webhook execution wave.

## Dependencies

**Prerequisites:** Epic 1 (deploy + secrets). Strong: Epic 2 (memory enriches meeting prep and cross-context queries). Soft: Epic 3 (constraints can gate external sends).
**Enables:** Epic 6 (proactive cross-context queries pull email + tasks + memory); richer daily briefings (briefing already deterministic — email adds overnight critical/high items).
**External Dependencies:** Nango (self-hosted), Gmail API, Microsoft Graph API, Google Calendar API, Zapier Embed.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Zero-trust violation (email content triggers action) | High | Low | Hard invariant + explicit automated test (Feature 5.3); sandboxed hostile-content framing on all external content |
| Nango self-hosted ops burden | Med | Med | Railway or Render for managed container hosting; Nango Cloud fallback if ops overhead is too high |
| Google OAuth app verification delays | Med | Med | Start verification process early; use test accounts during development |
| Zapier Embed pricing at scale | Med | Low | Validate per-user task consumption cost vs. subscription margins before productization |
| Zapier outage blocks long-tail approved actions | Med | Low | Approved actions stay in `approval_queue` as `pending`; surface as failed in `/approvals` with retry; retry on short backoff |
| Triage inaccuracy | Med | Med | Haiku batch + user-visible categories; user can re-classify |

## Technical Considerations

- Nango is the single OAuth authority for all providers — Coriven never stores raw access or refresh tokens. `nango.getToken()` is the only way server-side code obtains a provider token.
- Deep integrations (Gmail, Outlook, Calendar) use direct API calls for both read and write — Nango provides the token, Coriven writes the query logic. This preserves query flexibility (complex filters, on-demand fetches, 15-min polling cadence).
- Long-tail integrations use Zapier for execution only — Coriven does not query long-tail providers; it only fires approved actions at them.
- External content is always untrusted: email bodies, calendar descriptions, webhook payloads. Summarized for the user; never passed to Claude as instructions.
- `audit_log` is append-only, written by service-role only, never modified or deleted by user-facing code.
- Nango + Zapier Embed are multi-tenant by design — this architecture scales directly to productization without rearchitecting the integration layer.

## Compliance and Security

This Epic carries the security spine of the product: zero-trust external inputs, approval gates, append-only audit, and a provider token layer (Nango) with no raw credentials in Coriven's DB. A security review is required before shipping. GDPR-style cascades: deleting a user must disconnect Nango connections and delete Zapier connection metadata. Minimum OAuth scopes enforced per provider at connect time.

## Related Documentation
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9, §11, §17.4)
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Features 6, 7)
- Architecture: docs/architecture/_main/04-Architecture.md

## Architecture Decision Records (ADRs)
- ADR-009: Approval queue + append-only audit as the external-action gate
- ADR-013: Integration platform architecture — Nango + direct APIs + Zapier Embed

---
**Template Version:** 2.0 (3-layer, embedded features)
**Change Log:**
- v2.0 (2026-07-02): Replaced custom encrypted token storage + n8n with Nango (OAuth authority) + direct provider APIs + Zapier Embed (long-tail). Added Feature 5.5. Outlook moved in scope. ADR-005 replaced by ADR-013.
