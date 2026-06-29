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
epic: "1"
priority: "CRITICAL"
branch: "epic/1-foundation-closeout"
architecture: ["ADR-003", "ADR-004"]
tags: [coriven, foundation, deployment, tray, tauri]
relateddocuments:
  - "docs/architecture/_main/02-Product-Plan.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 1: Foundation Closeout

## Epic Overview
- **Epic ID:** Epic-1
- **Status:** Planning
- **Duration:** Short (closeout of already-built work)
- **Team:** Solo (owner/developer)
- **Priority:** CRITICAL (gates production use and every later Epic)

## Problem Statement

Phase 1 of Coriven is largely built — monorepo, Supabase schema + RLS, auth, task CRUD + UI, the Claude chat engine with tool use, per-user tool permissions, the separate `task_reminders` table, and a Windows tray daemon. What remains is the gap between "works on localhost" and "runs in production and reaches the user reliably." This Epic closes that gap so Coriven is a dependable daily driver and a stable base for Memory (Epic 2) and beyond. See Product Plan §17.1 and Architecture Appendix D (Known As-Built Issues).

## Goals and Success Criteria

Coriven runs in production, reminders fire reliably without a browser open, and the tray is on a sustainable cross-platform path.

**Success Metrics:**
- A reminder set 2 minutes out fires a native notification within 5 minutes with the browser closed; Snooze/Dismiss work end-to-end.
- `/api/tasks/due` returns correct due reminders from `task_reminders` (regression-tested).
- Production deploy on Vercel with all required env vars; auth + chat + tasks verified in prod.
- Tray runs from a single source of recurrence truth (`packages/types`), no duplicated logic.

## Scope

### In Scope
- Bug fixes to as-built Phase 1 code (see Features below).
- Vercel production deployment + environment configuration.
- Tray reliability: single recurrence source; decision/spike on the Tauri migration.
- Chat conversation reload on refresh.

### Out of Scope
- Any new product capability (memory, goals, comms, billing) — later Epics.
- Full Tauri Mac build/signing pipeline (tracked, may land here or defer to Productization per §13.4).

## Features & Waves

> Waves (atomic task breakdown + ordering) are determined in `/design-waves`. Each feature below references the Architecture doc and Business Requirements.

### Feature 1.1: As-Built Bug Fixes
- **Scope:** Correct the two known defects: `/api/tasks/due` querying the dropped `tasks.remind_at` column, and the tray duplicating `getNextOccurrence()`. (Both already fixed in working tree — this feature covers verification + regression tests.)
- **Key Technical Approach:** `/api/tasks/due` queries `task_reminders` joined to `tasks` (mirrors the snooze route's service-client + `user_id` pattern). Tray imports `getNextOccurrence` from `@personal-assistant/types` (single source). See Architecture §"Data Architecture" and Appendix D.
- **Requirements:** Business Requirements Feature 2 (Tasks & Reminders), acceptance criteria on `/api/tasks/due` and recurrence single-source.
- **Dependencies:** None.
- **Wave Planning:** Likely one wave (verify + add tests).

### Feature 1.2: Production Deployment
- **Scope:** Deploy the web app to Vercel from `main` with all env vars; verify auth, chat (SSE), and task flows in production.
- **Key Technical Approach:** Vercel auto-deploy from `main`; configure env vars per Architecture Appendix C (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`). Smoke test post-deploy. See Architecture §"Deployment Architecture."
- **Requirements:** Product Plan §17.1 remaining items; NFR availability.
- **Dependencies:** Feature 1.1 (don't ship the reminder bug to prod).
- **Wave Planning:** One wave (config + smoke test).

### Feature 1.3: Tray Reliability & Tauri Decision
- **Scope:** Ensure the tray is reliable now and decide the Tauri migration path. The tray must remain a thin shell (no business logic, no direct recurrence math).
- **Key Technical Approach:** Confirm the Node.js tray consumes shared recurrence logic; spike the Tauri thin-shell (poll `/api/tasks/due`, `/api/briefing/today`) per ADR-003. Decide whether full Tauri lands here or in Productization (signing cost, §13.4).
- **Requirements:** Architecture ADR-003; Business Requirements §"Tray" constraints.
- **Dependencies:** Feature 1.1 (correct due endpoint for the tray to poll).
- **Wave Planning:** Spike wave + (optional) migration wave.

### Feature 1.4: Chat Conversation Reload
- **Scope:** Reload prior conversation history into the chat UI on page refresh (currently messages only appear in the live SSE stream).
- **Key Technical Approach:** Fetch `conversation_messages` for the active `conversation_id` on mount; render into the existing chat components. See Architecture §"Frontend."
- **Requirements:** Business Requirements limitation (conversation not reloaded on refresh).
- **Dependencies:** None.
- **Wave Planning:** One wave.

## Dependencies

**Prerequisites:** None (this is the base Epic).
**Enables:** Every later Epic (Memory, Constraints, Goals, Comms, Proactive, Productization) builds on a deployed, reliable foundation.
**External Dependencies:** Vercel, Supabase, Anthropic; (Tauri spike) Rust toolchain.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Production env misconfig (missing secret) | High | Med | Checklist from Architecture Appendix C; smoke test |
| Tray logic drift returns | Med | Low | Enforce thin-shell rule; single recurrence source |
| Tauri migration scope balloons | Med | Med | Spike first; defer full build to Productization if costly |

## Technical Considerations

Modular monolith on Vercel + Supabase. The chat read path stays LLM-free except the user-facing call. Keep the tray a disposable shell so web/tray/mobile share backend logic (ADR-003).

## Compliance and Security

Per-user RLS already enforced; service-role key server-only; `.env.local` never committed (`.env.example` is the template). No new data classes introduced.

## Related Documentation
- Product Plan: docs/architecture/_main/02-Product-Plan.md
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md
- Architecture: docs/architecture/_main/04-Architecture.md (Appendix D — Known As-Built Issues)

## Architecture Decision Records (ADRs)
- ADR-003: Tauri tray replaces the Node.js daemon
- ADR-004: Reminders stay a separate `task_reminders` table

---
**Template Version:** 2.0 (3-layer, embedded features)
