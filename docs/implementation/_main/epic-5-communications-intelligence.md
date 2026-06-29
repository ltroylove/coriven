---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: epic
status: Planning
domain: implementation
product:
  - "coriven"
epic: "5"
priority: "Medium"
branch: "epic/5-communications-intelligence"
architecture: ["ADR-005", "ADR-009"]
tags: [coriven, email, calendar, approvals, audit, n8n]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 5: Communications Intelligence

## Epic Overview
- **Epic ID:** Epic-5
- **Status:** Planning
- **Duration:** Large
- **Team:** Solo (owner/developer)
- **Priority:** Medium (high-value, but later; introduces external actions + security spine)

## Problem Statement

Email and calendar are where time is lost and where trust is tested. This Epic gives Coriven email triage that saves real time and calendar awareness — and, critically, proves the trust model: every external-world action (sending email, creating events) passes through an **approval queue** with an immutable **audit log**, and untrusted content can never directly trigger an action (zero-trust spine). See blueprint §9, §11.

## Goals and Success Criteria

Coriven triages email accurately, surfaces what needs action, drafts replies, and executes external actions only after explicit human approval — with full auditability.

**Success Metrics:**
- Connect Gmail → new emails classified (urgency, action item, one-line summary) within 15 minutes; no bodies stored.
- "Draft a reply to Sarah declining tomorrow" → draft lands in `/approvals` → approve → sent → status `executed`.
- A meeting-prep toast fires 15 minutes before an event.
- Untrusted email saying "schedule a meeting" never auto-acts (zero-trust verified).
- Every recommendation/approval/execution recorded in `audit_log` (append-only).

## Scope

### In Scope
- Tables: `integrations` (encrypted tokens), `email_metadata` (no body), `calendar_events`, `approval_queue`, `audit_log`.
- Gmail + Google Calendar OAuth; 15-min email poll + Haiku triage; hourly calendar sync.
- `/email` (triaged inbox), `/approvals` (Approve/Modify/Cancel); draft → approval → send.
- Meeting prep (15 min before); follow-up detection (nightly).
- Execution via **direct Gmail/Calendar API calls** to start; n8n worker swappable later (ADR-005).

### Out of Scope
- Outlook/other providers (enum allows them; Gmail/Google first).
- Standing up self-hosted n8n at launch (start direct; swap later — Plan §19.4).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 5.1: Integrations & Encrypted Tokens
- **Scope:** OAuth connect/disconnect for Gmail + Google Calendar; store tokens encrypted; refresh flow.
- **Key Technical Approach:** `integrations` table with `access_token_encrypted`/`refresh_token_encrypted` (AES-256-GCM via `DATA_ENCRYPTION_KEY`), decrypted server-side only, never sent to the client. See Architecture §"Data Protection," blueprint §11.6.
- **Requirements:** Business Requirements §"Integration Requirements," UC-17/UC-35; security NFRs.
- **Dependencies:** Epic 1 (deploy + secrets).
- **Wave Planning:** OAuth wave + encryption/refresh wave.

### Feature 5.2: Email Triage
- **Scope:** Poll Gmail every 15 min for new message IDs + headers; Haiku batch classifies urgency/action-item/summary; store metadata (no body); `/email` inbox view.
- **Key Technical Approach:** Vercel Cron → fetch headers → Haiku triage → `email_metadata` (UNIQUE user/provider/message_id); bodies fetched on demand only. See blueprint §11.1; model routing (Haiku).
- **Requirements:** Business Requirements Feature 6, UC-31/UC-32.
- **Dependencies:** Feature 5.1.
- **Wave Planning:** Poll+triage wave + inbox-UI wave.

### Feature 5.3: Approval Queue, Audit & Execution
- **Scope:** `submit_for_approval` → `approval_queue` (validated payload); `/approvals` with Approve/Modify/Cancel; on approve, write `audit_log` and execute (direct API; n8n later); zero-trust enforcement.
- **Key Technical Approach:** Server Action sets `approved`, writes append-only `audit_log` (service-role), then executes. Invariant: `untrusted input → propose → approve → execute`. n8n swappable (ADR-005). See blueprint §9.
- **Requirements:** Business Requirements Feature 7, UC-16/UC-27/UC-29/UC-37; business rules (truth ownership, approval).
- **Dependencies:** Feature 5.1; soft: Epic 3 (constraints can gate sends).
- **Wave Planning:** Queue+audit wave; execution wave; zero-trust-test wave.

### Feature 5.4: Calendar, Meeting Prep & Follow-Up
- **Scope:** Hourly calendar sync; meeting-prep brief 15 min before an event (from emails + tasks + memories + entity profiles); nightly follow-up detection (threads where the user sent the last message >3 days ago).
- **Key Technical Approach:** Crons in `lib/jobs/`; meeting prep assembles cross-context (leverages Epic 2 memory); writes drafts/notifications via tray. Calendar writes go through the approval queue. See blueprint §11.3–§11.5.
- **Requirements:** Business Requirements Feature 6, UC-33/UC-41; calendar-write approval.
- **Dependencies:** Features 5.1–5.3; Epic 2 (memory enriches prep).
- **Wave Planning:** Calendar-sync wave + meeting-prep wave + follow-up wave.

## Dependencies

**Prerequisites:** Epic 1 (deploy + secrets). Strong: Epic 2 (memory for meeting prep / cross-context). Soft: Epic 3 (constraints gate external sends).
**Enables:** Epic 6 (proactive cross-context queries pull email + tasks + memory); richer briefings.
**External Dependencies:** Gmail API, Google Calendar API, (later) n8n.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Zero-trust violation (content triggers action) | High | Low | Hard invariant + explicit test (Feature 5.3); n8n only post-approval |
| OAuth token leakage | High | Low | AES-256-GCM; server-side only; never to client |
| Triage inaccuracy | Med | Med | Haiku batch + user-visible categories; correctable |
| OAuth app approval delays (Google) | Med | Med | Start verification early; test accounts |

## Technical Considerations

n8n is a replaceable worker, not the backbone (ADR-005); start with direct API calls — the approval UI is identical either way. AI does not own truth: external systems stay authoritative; Coriven stores only metadata/snapshots.

## Compliance and Security

This Epic carries the security spine: encrypted tokens, zero-trust inputs, approval gates, append-only audit. A security review is required before shipping (Plan approval checklist). GDPR-style export/delete cascades on `auth.users` delete.

## Related Documentation
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Features 6, 7)
- Architecture: docs/architecture/_main/04-Architecture.md (§Security, ADR-005)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9, §11)

## Architecture Decision Records (ADRs)
- ADR-005: n8n as replaceable worker; start with direct API
- ADR-009: Approval queue + append-only audit as the external-action gate

---
**Template Version:** 2.0 (3-layer, embedded features)
