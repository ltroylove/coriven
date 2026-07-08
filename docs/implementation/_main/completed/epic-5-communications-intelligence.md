---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-07-04T00:00:00"
version: "2.1"
type: epic
status: Completed
domain: implementation
product:
  - "coriven"
epic: "5"
priority: "Medium"
branch: "epic/5-communications-intelligence"
architecture: ["ADR-009", "ADR-013"]
tags: [coriven, email, calendar, approvals, audit, nango]
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

Email and calendar are where time is lost and where trust is tested. This Epic gives Coriven email triage that saves real time and calendar awareness — and, critically, proves the trust model: every external-world action (sending email, creating events) passes through an **approval queue** with an immutable **audit log**, and untrusted content can never directly trigger an action (zero-trust spine). See blueprint §9, §11.

The 2025 incident record validates this design: **ShadowLeak** (zero-click Gmail exfiltration via ChatGPT's agent) and **EchoLeak** (CVE-2025-32711, same pattern against Microsoft 365 Copilot) are precisely Coriven's threat model, and both showed that injection *detection* fails — the effective defense is restricting what the agent can do: capability restriction + egress control + human approval. That is this Epic.

The integration architecture (ADR-013) is multi-tenant from day one so it scales directly into productization. Long-tail connectors ("connect all of life") are **deferred to a dedicated post-validation epic** — see ADR-013 Layer 3 for the recorded constraints (MCP-shaped interface, Composio/Pipedream candidates, Zapier ruled out as primary).

## Goals and Success Criteria

Coriven triages email accurately, surfaces what needs action, drafts replies, and executes external actions only after explicit human approval — with full auditability.

**Success Metrics:**
- Connect Gmail via Nango → new emails classified (urgency, action item, one-line summary) within 15 minutes; no bodies stored.
- Connect Outlook via Nango alongside Gmail with no additional OAuth implementation.
- "Draft a reply to Sarah declining tomorrow" → draft lands in `/approvals` **showing the raw action payload** (exact recipient, subject, full body — never only an AI summary) → approve → sent → status `executed`.
- A meeting-prep brief fires 15 minutes before an event.
- Untrusted email saying "schedule a meeting" never auto-acts (zero-trust verified by explicit automated test).
- Every recommendation/approval/execution recorded in `audit_log` (append-only).

## Integration Architecture (ADR-013, revised 2026-07-04)

| Layer | Tool | Responsibility |
|-------|------|---------------|
| OAuth authority | **Self-hosted Nango** | All provider OAuth flows + token storage + refresh. Coriven stores only `nango_connection_id` — no raw tokens in DB. Self-hosting keeps the Gmail data path inside our Google CASA assessment boundary. |
| Deep integrations | **Direct provider APIs** | Gmail, Outlook, Google Calendar — read path (poll/fetch) and write path (approved actions). Token fetched from Nango server-side per call. |
| Long-tail connectors | **Deferred** | Not in this Epic. Future epic post-validation; the execution router (Feature 5.3) keeps a clean provider-routing seam so the path can be added without rework. |

All execution paths write to `audit_log`. Refresh tokens never leave Nango.

## Scope

### In Scope
- **Tables:** `integrations` (`nango_connection_id` + `provider` + `user_id` — no raw tokens), `email_metadata` (no body stored), `calendar_events`, `approval_queue`, `audit_log`.
- **Nango:** self-hosted instance with **external Postgres + Redis** (bundled containers not production-safe; separate DB, not co-mingled with Coriven's Supabase); OAuth connect/disconnect UI for Gmail, Outlook, and Google Calendar in `/settings/integrations`.
- **Email:** Gmail + Outlook poll every 15 min via Vercel Cron; Haiku batch triage; `/email` inbox view.
- **Approvals:** `submit_for_approval` → `/approvals` (Approve/Modify/Cancel, **raw payload display**) → execute → `audit_log`.
- **Calendar:** hourly sync; meeting-prep brief 15 min before event; nightly follow-up detection.
- **Zero-trust enforcement:** untrusted content (email bodies, calendar descriptions) sandboxed — never passed to Claude as instructions; **egress allowlist** on model output (strip/neutralize non-allowlisted URLs and images — both 2025 incidents exfiltrated via URLs, not actions).
- **Scope sequencing option:** `gmail.readonly` may launch before `gmail.send` to shrink the injection blast radius during the pilot.

### Out of Scope
- **Long-tail connectors** (Slack, Notion, fitness, smart home, etc.) — dedicated post-validation epic per ADR-013 Layer 3. Zapier Embed ruled out as primary (user-pays economics); candidates Composio/Pipedream Connect behind an MCP-shaped interface.
- **Banking/financial integrations** — dedicated aggregator (Plaid/Teller) in a future epic, never a general-purpose iPaaS.
- IMAP/SMTP for non-OAuth providers (Yahoo, etc.).
- Nango Cloud (self-hosted for validation; revisit at productization).
- Google CASA assessment — exempt under 100 Gmail accounts; budgeted for productization (~$1–5K/yr recurring, 2–6 month first pass; start verification early).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 5.1: Nango Integration & Provider Connect UI
- **Scope:** Stand up self-hosted Nango (external Postgres + Redis); OAuth connect/disconnect flows for Gmail, Outlook, and Google Calendar; `integrations` table (`nango_connection_id`, `provider`, `user_id`, `scopes`, `connected_at`); server-side `nango.getToken()` wrapper used by all subsequent features.
- **Key Technical Approach:** Nango self-hosted (Docker on Railway/Render); Nango SDK (`@nangohq/node`); connect flow from `/settings/integrations`; `integrations` stores only the connection ID. Minimum scopes: Gmail (`gmail.readonly`, `gmail.send`), Outlook (`Mail.Read`, `Mail.Send`), Google Calendar (`calendar.readonly`, `calendar.events`). **Setup constraints (research-validated):** vault the Nango encryption key before first deploy — it cannot be rotated; document the compromise runbook (bulk revoke + re-auth all users); get written confirmation from Nango that Auth-only self-hosted commercial use is permitted under ELv2; no webhooks on free self-hosted — handle `getToken()` failures gracefully; network-isolate the instance; keep the token wrapper thin so a swap to self-rolled refresh logic stays cheap. See ADR-013.
- **Requirements:** Business Requirements §"Integration Requirements," UC-17/UC-35; security NFRs.
- **Dependencies:** Epic 1 (deploy + secrets).
- **Wave Planning:** Nango setup + DB wave → connect/disconnect UI wave.

### Feature 5.2: Email Triage (Gmail + Outlook)
- **Scope:** Poll Gmail and Outlook every 15 min for new message IDs + headers; Haiku batch classifies urgency/action-item/one-line summary; store metadata in `email_metadata` (no body); `/email` inbox view with categories and urgency indicators.
- **Key Technical Approach:** Vercel Cron → `nango.getToken()` → fetch headers from Gmail API + Microsoft Graph → Haiku triage batch → `email_metadata` (UNIQUE on `user_id`/`provider`/`message_id`). Bodies fetched on demand only via `get_email_thread` tool with hostile-content framing. See blueprint §11.1.
- **Requirements:** Business Requirements Feature 6, UC-31/UC-32.
- **Dependencies:** Feature 5.1.
- **Wave Planning:** Poll + triage wave → inbox UI wave.

### Feature 5.3: Approval Queue, Audit & Execution
- **Scope:** `submit_for_approval` tool → `approval_queue` (validated payload, typed `action_type`); `/approvals` UI with Approve/Modify/Cancel showing **raw action payloads**; on approve — execute via direct provider API → write `audit_log`; zero-trust enforcement tested explicitly; egress allowlist on model output.
- **Key Technical Approach:** Server Action validates approval, writes append-only `audit_log` (service-role only), then executes: `nango.getToken()` → direct provider API. The execution router keeps a clean provider-routing seam for the future long-tail path (ADR-013 Layer 3). Invariant: `untrusted input → propose → approve → execute`. **Approval-context integrity:** the UI renders the exact payload (recipient, subject, full body, URLs) — an LLM summary may accompany but never replace it, since the summary is model output and injectable. Execution-time constraint check (Epic 3 gate) fails closed. `audit_log` records the delegation chain (user → Coriven → provider connection) per action. See ADR-009, ADR-013 §Security, blueprint §9.
- **Requirements:** Business Requirements Feature 7, UC-16/UC-27/UC-29/UC-37; business rules (truth ownership, approval gate).
- **Dependencies:** Feature 5.1; soft: Epic 3 (constraints gate sends).
- **Wave Planning:** Queue + audit wave → execution routing wave → zero-trust test wave.

### Feature 5.4: Calendar Intelligence, Meeting Prep & Follow-Up
- **Scope:** Hourly calendar sync to `calendar_events`; meeting-prep brief assembled 15 min before each event (from related emails + tasks + memories + entity profiles); nightly follow-up detection (threads where user sent last message >3 days ago, no reply). Calendar writes (create/update event) through the approval queue.
- **Key Technical Approach:** Vercel Crons in `lib/jobs/`; meeting prep is deterministic assembly (ADR-008 pattern) — cross-context pull from `email_metadata`, `tasks`, `memories`, `entity_profiles`. `nango.getToken()` for Google Calendar + Outlook Calendar API calls. Calendar write actions go through Feature 5.3 approval queue. See blueprint §11.3–§11.5.
- **Requirements:** Business Requirements Feature 6, UC-33/UC-41.
- **Dependencies:** Features 5.1–5.3; Epic 2 (memory enriches prep).
- **Wave Planning:** Calendar sync wave → meeting-prep wave → follow-up detection wave.

## Dependencies

**Prerequisites:** Epic 1 (deploy + secrets). Strong: Epic 2 (memory enriches meeting prep and cross-context queries). Soft: Epic 3 (constraints can gate external sends).
**Enables:** Epic 6 (proactive cross-context queries pull email + tasks + memory); richer daily briefings; future long-tail connector epic (execution-router seam).
**External Dependencies:** Nango (self-hosted), Gmail API, Microsoft Graph API, Google Calendar API.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Zero-trust violation (email content triggers action) | High | Low | Hard invariant + explicit automated test (Feature 5.3); hostile-content framing; egress allowlist; raw-payload approval UI |
| Injection-influenced approval (user approves on false pretenses) | High | Med | Approval UI shows exact raw payload — LLM summary never replaces it |
| Nango self-hosted ops burden | Med | Med | Railway/Render managed containers; external Postgres + Redis; Nango Cloud fallback if overhead too high |
| Nango encryption key compromise (non-rotatable) | High | Low | Key vaulted pre-deploy; documented runbook: bulk revoke via provider APIs + re-auth all users |
| Nango free self-hosted tier narrows further | Med | Med | Usage is Auth-only (inside free tier today); thin `getToken()` wrapper keeps swap to self-rolled refresh cheap; re-check tier every ~6 months |
| Google OAuth app verification delays | Med | Med | Start early; <100-user exemption covers validation phase; CASA budgeted for productization |
| Triage inaccuracy | Med | Med | Haiku batch + user-visible categories; user can re-classify |

## Technical Considerations

- Nango is the single OAuth authority — Coriven never stores raw access or refresh tokens. `nango.getToken()` (via the thin wrapper) is the only way server-side code obtains a provider token.
- Deep integrations use direct API calls for both read and write — Nango provides the token, Coriven writes the query logic (complex filters, on-demand fetches, 15-min polling).
- External content is always untrusted: email bodies, calendar descriptions, API responses. Summarized for the user; never passed to Claude as instructions. Egress allowlist on model output.
- `audit_log` is append-only, written by service-role only, records the delegation chain per action.
- The architecture is multi-tenant by design and scales to productization without rearchitecting; the execution router's provider seam is where the future long-tail epic plugs in.

## Compliance and Security

This Epic carries the security spine of the product: zero-trust external inputs, approval gates with raw-payload display, egress control, append-only audit, and a provider token layer (Nango) with no raw credentials in Coriven's DB. A security review is required before shipping. GDPR-style cascades: deleting a user must revoke and delete their Nango connections. Minimum OAuth scopes enforced per provider at connect time. Google CASA Tier 2 (~$1–5K/yr) becomes mandatory past 100 Gmail users — in the productization budget. Microsoft publisher verification obtained early (free; gates enterprise consent).

## Related Documentation
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9, §11, §17.4)
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Features 6, 7)
- Architecture: docs/architecture/_main/04-Architecture.md

## Architecture Decision Records (ADRs)
- ADR-009: Approval queue + append-only audit as the external-action gate
- ADR-013: Integration platform architecture — Nango + direct provider APIs (long-tail deferred)

---
**Template Version:** 2.0 (3-layer, embedded features)
**Change Log:**
- v2.1 (2026-07-04): Research validation pass. Feature 5.5 (Zapier Embed) removed — long-tail connectors deferred to a post-validation epic (ADR-013 Layer 3). Security hardening folded in: raw-payload approval UI, egress allowlist, Nango setup constraints (non-rotatable key, external Postgres/Redis, ELv2 confirmation), CASA budget note, readonly-before-send option.
- v2.0 (2026-07-02): Replaced custom encrypted token storage + n8n with Nango + direct provider APIs + Zapier Embed. Added Feature 5.5. Outlook moved in scope.
