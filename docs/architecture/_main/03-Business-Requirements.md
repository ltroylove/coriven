---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: foundation-requirements
status: Draft
domain: product
product:
  - "coriven"
tags: [coriven, requirements, use-cases, roles]
relateddocuments:
  - "01-Product-Vision.md"
  - "02-Product-Plan.md"
  - "04-Architecture.md"
  - "05-User-Experience.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Coriven — Business Requirements

> Synthesized from the master blueprint, with roles and use cases expanded via the use-case-discovery 5-pass method. The blueprint governs on conflict.

## Document Overview

### Purpose

Define what Coriven must do — features, roles, use cases, business rules, and non-functional requirements — as the bridge from the Vision/Plan to the Architecture and implementation.

### Scope

Covers all phases (Foundation → Productization). Phase 1 is described as **Current State (as-built)**; Phases 2–6 as required future capability. Excludes deferred features (graph memory, medication tracking, voice, MCP exposure, team contexts — see blueprint §18).

### Audience

The owner/developer; future contributors; (later) beta stakeholders.

## Business Context

### Business Problem

Tools track *what* but not *why*; AI assistants forget context across sessions and violate standing "never do X" rules. No integrated system reasons over goals, holds compounding memory, and reaches the user proactively while keeping humans in control of external actions.

### Current State Analysis

#### Current Process/System (as-built, Phase 1)

A working Next.js 15 monorepo: Supabase schema + RLS, email/password auth (4 Supabase client variants + middleware), task CRUD + UI, a separate `task_reminders` table with recurrence, a Claude chat engine with tool use (7 task/reminder tools) gated by per-user `tool_permissions`, and a Node.js Windows tray daemon that polls for due reminders and fires native toasts.

#### Pain Points

1. **Pain Point**: AI forgets people, projects, preferences between sessions.
   - **Impact**: Constant re-explanation; low compounding value. **Frequency**: Every session. **Affected**: Primary user.
2. **Pain Point**: AI ignores explicit constraints (e.g., "don't modify MealPrepForge code").
   - **Impact**: Erodes trust. **Frequency**: Recurring. **Affected**: Primary user.
3. **Pain Point**: Tasks disconnected from goals; goals silently abandoned.
   - **Impact**: Effort misaligned with intent. **Frequency**: Ongoing. **Affected**: Primary user.

#### Current System Limitations

- [x] `/api/tasks/due` is broken — queries a `tasks.remind_at` column dropped in migration `20260620140813`; must query `task_reminders`.
- [x] Tray duplicates `getNextOccurrence()` locally instead of importing from `packages/types` (divergence risk).
- [x] No persistent memory, goals, briefing, email/calendar, approvals, or billing yet.
- [x] Conversation history not reloaded into the chat UI on page refresh.

### Desired Future State

An assistant that remembers structurally, organizes by goal, surfaces proactively, gates external actions behind approval, and converts to paid at the entity cap.

#### Business Benefits

1. **Benefit**: Compounding context.
   - **Quantification**: Cross-session recall regardless of recency (sister/Coke problems solved).
   - **Measurement**: Recall-win events per week; `/memory` correctness.
2. **Benefit**: Goal alignment + proactivity.
   - **Quantification**: Stalled goals nudged after 14 days; daily briefing surfaces momentum.
   - **Measurement**: Nudges fired/acted on; briefings opened.

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder | Role | Responsibilities | Success Criteria | Communication |
|---|---|---|---|---|
| Roy (owner) | Dev + first user | Build, use daily, decide scope | Daily-driver utility; productizable | Continuous |
| MealPrepForge LLC | Business/payments | DBA, Stripe, liability | Clean revenue line | As needed |
| Beta users (future) | Customers | Use, pay, give feedback | Memory quality at fair price | At beta |

### User Roles and Personas

> **Use-case discovery summary:** A 5-pass discovery expanded the initial customer-facing view (one primary user, happy paths) into **~20 roles** (human, automated-system, and external actors) and **~42 use cases** spanning happy paths, operational/management, edge/error flows, integrations, and compliance/reporting. This prevents discovering large scope expansion later.

**Human roles:** Primary User (owner) · New User (onboarding) · Free-tier Beta User · Subscriber (Core/Pro) · Account/Billing self-manager · Privacy/Data manager (memory + export/delete).

**Automated system actors (Coriven's own components):** Chat Engine (tool-use loop) · Sentinel (async memory) · Briefing Cron · Email-Triage Cron · Calendar-Sync Cron · Pattern-Detection Cron · Meeting-Prep Cron · Tray Daemon · Approval Executor (n8n/direct API) · Pre-Action Constraint Checker.

**External actors:** Gmail · Google Calendar · Stripe · Supabase Auth.

#### Primary User Role: Owner / Daily Driver

- **Description**: Technical founder running multiple efforts.
- **Goals**: Organize life by goals; offload remembering; be nudged before things slip; trust the assistant with constraints.
- **Pain Points**: Lost context; forgetful/non-compliant AI; goal drift.
- **Success Criteria**: Reminders fire reliably; memory compounds and is correctable; goals tracked.
- **Usage Patterns**: Daily, across desktop (web + tray) and later mobile (PWA).
- **Technical Proficiency**: High. **AI Experience**: High.

#### Secondary User Role: Free-tier Beta User

- **Description**: Tries Coriven via the no-CC trial.
- **Goals**: See whether it remembers them; quick wins.
- **Pain Points**: Hits the 10-entity / 1-reminder-per-day caps.
- **Success Criteria**: Feels the value at the cap → converts.
- **Technical Proficiency**: Medium. **AI Experience**: Low–Medium.

## Functional Requirements

### Core Features

#### Feature 1: Goal Hierarchy & Tasks

- **Description**: Life Area → Goal → Project → Task → Reminder. Goals carry `why_it_matters`, `success_metrics`, status, confidence, momentum. Tasks optionally link to a project and/or goal.
- **Business Justification**: Organizing by *why* is the core differentiator.
- **User Story**: As the owner, I want every task tied to a goal so the system can tell me whether my actions serve my intentions.
- **Priority**: High.
- **Acceptance Criteria**:
  - [ ] Create Life Area → Goal (with why + metrics) → Project → Task.
  - [ ] Link/unlink a task to a project/goal.
  - [ ] Momentum recomputed nightly per the formula (§7.3 blueprint) and stored on `goals.momentum`.
- **Dependencies**: Tasks (built); goals tables (Phase 3).

#### Feature 2: Tasks & Reminders (Current State)

- **Description**: Task CRUD; reminders as separate `task_reminders` rows with `remind_at`, `snoozed_until`, `recurrence_type` (none/daily/weekdays/weekly/monthly/yearly), `recurrence_end_at`, `last_fired_at`.
- **User Story**: As the owner, I want reminders that recur and snooze so I'm notified at the right time.
- **Priority**: High (built; fix `/api/tasks/due`).
- **Acceptance Criteria**:
  - [ ] `/api/tasks/due` returns reminders due from `task_reminders` (not the dropped column).
  - [ ] `getNextOccurrence()` in `packages/types` is the single source for recurrence (tray imports it).
  - [ ] Snooze via `/api/tasks/[id]/snooze` updates `snoozed_until`.

#### Feature 3: Chat & Tool-Use Engine

- **Description**: Claude (Sonnet) chat with streaming and an agentic tool loop; only tools enabled in `tool_permissions` are passed to the model.
- **User Story**: As the owner, I want to manage tasks/goals/memory through natural conversation.
- **Priority**: High (built; grows each phase).
- **Acceptance Criteria**:
  - [ ] Disabled tools are never offered to the model.
  - [ ] Tool calls execute, results feed back, loop continues (cap ~10 turns).
  - [ ] Full exchange persisted to `conversation_messages` (incl. `tool_calls`).

#### Feature 4: Three-Layer Memory → Sentinel

- **Description**: (2a) Entity profiles always in context + pgvector semantic memory + conversation summaries, assembled synchronously. (2b) Async Sentinel builds a pre-built context package (Upstash + Supabase fallback) read by the chat route.
- **User Story**: As the owner, I want Coriven to remember my people/preferences and recall them regardless of how long ago I said them.
- **Priority**: High (Phase 2).
- **Acceptance Criteria**:
  - [ ] Sister problem & Coke/Pepsi problem solved across sessions.
  - [ ] Contradiction → old memory `superseded_by` new; superseded excluded from default retrieval, still queryable.
  - [ ] `/memory` page lists/edits/deletes entities and memories.
  - [ ] (2b) Chat route reads the Sentinel package before generating (integration contract verified); failures fall back gracefully and never block.

#### Feature 5: Daily Briefing (Deterministic)

- **Description**: Template-assembled briefing (no LLM): goals in motion, upcoming 7 days, stalled goals, approvals pending. Vercel Cron at the user's time (timezone-aware); tray delivers.
- **Priority**: High (Phase 3).
- **Acceptance Criteria**: One `daily_briefings` row per user/day; tray fires a toast if `was_delivered = false`.

#### Feature 6: Communications Intelligence

- **Description**: Gmail poll (15 min) + Haiku triage (urgency, action item, one-line summary; **no body stored**); calendar sync; draft → approval → send; meeting prep; follow-up detection.
- **Priority**: Medium (Phase 4).
- **Acceptance Criteria**: Emails classified within 15 min; drafted reply lands in `/approvals`; approve → sent; meeting-prep toast 15 min before an event.

#### Feature 7: Approval Queue & Audit

- **Description**: Every external-world change stops at `approval_queue` (pending → approved/rejected → executed); immutable `audit_log` records all recommendations, approvals, executions.
- **Priority**: High (Phase 4; pattern enforced earlier).
- **Acceptance Criteria**: No external action executes without an authenticated approval; rejections logged; audit append-only.

#### Feature 8: Proactive Intelligence

- **Description**: Nightly pattern detection; stale-goal nudges (14 days); Friday weekly review; cross-context queries.
- **Priority**: Medium (Phase 5).

#### Feature 9: Productization

- **Description**: Stripe tiers + enforcement middleware (entity/reminder caps, page access); entity-cap upgrade prompt; pricing page; $199 lifetime + 7-day no-CC trial; onboarding wizard; PWA + Web Push.
- **Priority**: Medium (Phase 6).

#### Feature 10: Behavioral-Constraint Registry (Conditional — §19.1)

- **Description**: User-authored, locked constraints (`rule`, `rationale`, `scope`) stored/retrieved separately from facts; an engine-level pre-action check before tool calls; optional post-generation violation detection.
- **Priority**: Conditional, after Phase 2.
- **Acceptance Criteria**: Constraint adherence materially above the ~42.5% baseline in test scenarios (e.g., "never modify MealPrepForge code").

### AI-Specific Requirements

#### Natural Language Processing

- **Input**: Text (chat); later voice (deferred). **Languages**: English.
- **Understanding**: Intent recognition, entity extraction/resolution (aliases, fuzzy match ≤2 Levenshtein), tool selection.
- **Output**: Streamed natural language; structured tool calls (JSON-Schema inputs).

#### Machine Learning Capabilities

- **Learning**: Memory updates via the Mem0 ADD/UPDATE/DELETE/NOOP pattern (LLM-classified against top-k similar memories).
- **Training data**: None — pre-trained models only; the user's own data drives memory.
- **Model routing**: Haiku for extraction/triage; Sonnet for chat reasoning; OpenAI for embeddings.

#### AI Transparency & Explainability

- **Explanation**: Memory and entities are user-visible and editable (`/memory`); approvals show what + why.
- **Audit trail**: `audit_log` records every recommendation, approval, and execution.
- **Human override**: Approval/Modify/Cancel on every external action; not autonomous.

### Data Requirements

#### Input Data

| Data Type | Source | Format | Volume | Quality | Update |
|---|---|---|---|---|---|
| User messages | Chat UI | text | per turn | n/a | real-time |
| Email metadata | Gmail API | JSON | per poll | headers only | 15-min batch |
| Calendar events | Calendar API | JSON | per sync | provider | hourly |
| OAuth tokens | OAuth flow | encrypted text | once | n/a | on refresh |

#### Output Data

| Data Type | Destination | Format | Consumer | Retention |
|---|---|---|---|---|
| Memories | `memories` (+embedding) | text/vector | Chat engine/Sentinel | until superseded/deleted |
| Briefings | `daily_briefings` | text | Tray/UI | per policy |
| Approvals | `approval_queue` | jsonb payload | User/executor | per policy |
| Audit records | `audit_log` | jsonb | Owner | append-only |

#### Data Quality Standards

- **Accuracy**: Memory must be correctable by the user; supersession over deletion.
- **Timeliness**: Sentinel package built in ~2–5s; usually ready before the next message.
- **Consistency**: Single source for recurrence math (`packages/types`).

### Integration Requirements

| System | Integration | Data Flow | Frequency | Auth | Error Handling |
|---|---|---|---|---|---|
| Gmail | REST | inbound metadata; outbound send via approval | 15-min poll / on demand | OAuth (encrypted) | retry; surface failure |
| Google Calendar | REST | inbound events; outbound via approval | hourly | OAuth (encrypted) | retry |
| n8n (or direct API) | Webhook | outbound approved actions | on approve | shared secret | log; mark failed |
| Stripe | REST + webhook | subscriptions | on event | API key/webhook secret | webhook idempotency |
| Anthropic / OpenAI / Upstash | REST | AI + cache | per request | API keys | graceful fallback |

## Non-Functional Requirements

### Performance

- **Chat read path**: ~1ms cache fetch for the Sentinel package (no LLM in the read path).
- **Sentinel build**: ~2–5s async; never blocks the response.
- **Reminder latency**: due reminder fires within the tray poll window (~5 min).

### Scalability

- **Scale**: Per-user (<100k memory rows expected); pgvector sufficient; RLS multi-tenancy already in place.
- **Strategy**: Serverless (Vercel + Supabase + Upstash); horizontal by default.

### Availability

- **Degradation**: Sentinel/Upstash failure → Supabase fallback → session context; chat continues.
- **Tray offline**: fire from the last cached payload.

### Security

#### Authentication & Authorization

- Supabase Auth (email/password + SSR sessions; 4-client pattern). Per-user RLS (`user_id = auth.uid()`). Tier checks in middleware before tool execution/page access.

#### Data Protection

- **Encryption in transit**: HTTPS everywhere. **At rest**: Supabase managed; OAuth tokens AES-256-GCM (`DATA_ENCRYPTION_KEY`), decrypted server-side only.
- **Minimization**: Email **bodies not stored** (privacy + token cost); fetched on demand.
- **Zero-trust inputs**: external content can be summarized/proposed on, never directly invoke an action.

#### Compliance

- [ ] GDPR-style data export + account deletion (cascade on `auth.users` delete) — Privacy/Data manager role.
- [ ] Audit log append-only (service-role writes only).
- [ ] Industry-specific regulation: not applicable to a personal-productivity product.

### Usability

- **UI**: Responsive Next.js web → PWA; Tauri tray for notifications.
- **Accessibility**: WCAG 2.1 AA target.
- **Error handling**: clear, recoverable messages; graceful AI-unavailable states.

### Reliability

- **Fault tolerance**: approval execution failures logged and retryable; Sentinel non-blocking.
- **Data integrity**: supersession preserves history; audit immutability.

## Business Rules

### Core Business Rules

1. **Rule**: AI never becomes the system of record.
   - **Rationale**: "AI does not own truth." **Implementation**: external writes only via approval → executor. **Exceptions**: Coriven's own tables (tasks/goals/entities/memories/approvals/audit).
2. **Rule**: External-world changes require explicit human approval.
   - **Rationale**: trust + safety. **Implementation**: `submit_for_approval` → `approval_queue`. **Exceptions**: drafting, summarizing, internal CRUD.

### AI-Specific Business Rules

1. **Rule**: Disabled tools are never exposed to the model.
   - **Threshold**: `tool_permissions.enabled = true`. **Action**: omit from the tool list.
2. **Rule**: Untrusted content cannot trigger actions.
   - **Trigger**: any external source. **Process**: summarize/propose → user approves → execute.
3. **Rule (conditional)**: A pre-action check blocks tool calls that violate a locked constraint.
   - **Trigger**: before any tool execution. **Process**: check `behavioral_constraints`; block + surface on match.

### Data Governance Rules

- **Retention**: memories until superseded/deleted; memory **window enforced at retrieval by tier** (Free 24h / Core 7d / Pro 30d, §19.6). **Access**: user-only via RLS. **Sharing**: none externally.

## Use Cases & Scenarios

> Discovered via the 5-pass method. ~42 use cases below; representative ones detailed, the rest tabulated.

### Primary Use Cases (detailed)

#### UC-10: Cross-Session Recall (the "sister problem")

- **Actor**: Primary User (+ Sentinel, Chat Engine).
- **Preconditions**: Memory phase live; entity "Sarah" stored ("Roy's sister, Denver").
- **Basic Flow**: (1) New session: user says "I'm visiting my sister." (2) Sentinel/context assembly resolves "sister" → Sarah → Denver. (3) Coriven replies mentioning Denver and offers to look at flights.
- **Alternative**: "Sarah moved to Austin" → old memory `superseded_by`; future recall says Austin.
- **Exception**: Ambiguous "sister" with two candidates → disambiguation prompt.
- **Postcondition**: Correct location recalled without re-statement.
- **Business Value**: The core compounding-memory promise.

#### UC-16: Approve an External Action

- **Actor**: Primary User (+ Chat Engine, Approval Executor).
- **Preconditions**: Comms phase; a draft action exists.
- **Basic Flow**: (1) Claude calls `submit_for_approval`. (2) Row inserted `pending`; payload validated. (3) Tray notifies. (4) User opens `/approvals`, reviews what + why. (5) Approve → authenticated action sets `approved`, writes `audit_log`, fires executor → `executed`.
- **Alternative**: Modify params inline then approve. **Exception**: Reject → logged, nothing executes.
- **Business Value**: Trust via human-in-the-loop.

### All Use Cases (by discovery pass)

| Pass | ID | Use Case | Primary Actor(s) | Phase |
|---|---|---|---|---|
| 1 Happy paths | UC-1 | Create task + reminder (chat/UI) | User, Chat Engine | 1 |
| 1 | UC-2 | Snooze/dismiss reminder via tray | User, Tray | 1 |
| 1 | UC-3 | Converse with Coriven | User, Chat Engine | 1 |
| 1 | UC-4 | Recurring reminder fires repeatedly | Tray, Briefing/Reminder logic | 1 |
| 1 | UC-5 | Complete task → momentum updates | User, Pattern/Goal logic | 3 |
| 1 | UC-6 | Create goal with why + metrics | User | 3 |
| 1 | UC-7 | Link task to project/goal | User | 3 |
| 1 | UC-8 | Receive daily briefing | Briefing Cron, Tray | 3 |
| 1 | UC-9 | Teach Coriven a fact | User, Sentinel | 2 |
| 1 | UC-10 | Cross-session recall (sister/Coke) | User, Sentinel | 2 |
| 1 | UC-11 | Manage tool permissions | User | 1 |
| 2 Operational | UC-12 | View/edit/delete entities & memories | Privacy/Data mgr | 2 |
| 2 | UC-13 | Correct/supersede a fact | User, Sentinel | 2 |
| 2 | UC-14 | Manage subscription | Billing self-mgr, Stripe | 6 |
| 2 | UC-15 | Author a behavioral constraint | User | post-2 |
| 2 | UC-16 | Approve/modify/cancel queued action | User, Executor | 4 |
| 2 | UC-17 | Connect/disconnect integration | User, Gmail/Calendar | 4 |
| 2 | UC-18 | Configure briefing time/timezone | User | 3 |
| 2 | UC-19 | Onboarding wizard (first goal+task) | New User | 6 |
| 3 Edge/error | UC-20 | Sentinel/Upstash down → fallback | Sentinel, Chat Engine | 2 |
| 3 | UC-21 | Rapid-fire messages → prior package | Sentinel | 2 |
| 3 | UC-22 | Entity cap hit → upgrade prompt | Free User | 6 |
| 3 | UC-23 | Reminder cap hit (1/day free) | Free User | 6 |
| 3 | UC-24 | Memory window expiry by tier | User | 6 |
| 3 | UC-25 | Ambiguous entity → disambiguation | User, Chat Engine | 2 |
| 3 | UC-26 | Offline tray → cached payload | Tray | 1 |
| 3 | UC-27 | Untrusted "schedule meeting" → no auto-act | Chat Engine | 4 |
| 3 | UC-28 | Disabled tool never offered | Chat Engine | 1 |
| 3 | UC-29 | Approval rejected → logged, no exec | User, Executor | 4 |
| 3 | UC-30 | Constraint violation blocked | Constraint Checker | post-2 |
| 4 Integrations | UC-31 | Email triage poll + classify | Email-Triage Cron | 4 |
| 4 | UC-32 | Fetch email body on demand | User, Gmail | 4 |
| 4 | UC-33 | Calendar sync | Calendar-Sync Cron | 4 |
| 4 | UC-34 | Draft → approval → send | User, Executor | 4 |
| 4 | UC-35 | OAuth token refresh (encrypted) | System, Gmail/Calendar | 4 |
| 4 | UC-36 | Embedding generation for new memory | Sentinel, OpenAI | 2 |
| 5 Compliance | UC-37 | Audit log every action | System | 4 |
| 5 | UC-38 | Weekly review (Fri 5pm) | Pattern Cron, Tray | 5 |
| 5 | UC-39 | Data export / account deletion | Privacy/Data mgr | 6 |
| 5 | UC-40 | Stale-goal nudge (14 days) | Briefing/Pattern Cron | 3/5 |
| 5 | UC-41 | Meeting prep brief (15 min before) | Meeting-Prep Cron, Tray | 4 |
| 5 | UC-42 | Pattern detection nightly | Pattern Cron, Tray | 5 |

### Edge Cases & Error Scenarios

1. **Scenario**: Sentinel/Upstash unavailable.
   - **Expected**: Chat falls back to Supabase-persisted package, then session context; logs; never blocks.
   - **User Communication**: None visible (graceful) — slightly staler context at worst.
2. **Scenario**: Free user hits the entity cap.
   - **Expected**: Block new entity; show contextual upgrade prompt at entity #10.
   - **User Communication**: "Coriven can't remember anyone else" → upgrade CTA.

## Workflow & Process Design

### Future State Workflow (chat turn)

User message → load context (Sentinel package or inline memory) + enabled tools → Claude responds or calls a tool → execute → feed back → loop → persist exchange → Sentinel fires async on user + assistant messages.

### Process Improvements

| Process Step | Current | Future | Improvement | Automation |
|---|---|---|---|---|
| Recall standing context | Manual re-statement | Automatic | Eliminated | Full |
| Goal tracking | Manual/none | Momentum + nudges | Proactive | Full |
| Email triage | Manual scan | AI-classified inbox | Time saved | Semi |
| External actions | Manual | Drafted + approval-gated | Safer/faster | Semi |

### Exception Handling

- **AI failures**: graceful degradation; chat continues without enrichment.
- **Process failures**: approval execution errors logged + retryable.
- **Data quality**: user-correctable memory; supersession.

## Success Criteria & Metrics

### Business KPIs

1. **KPI**: Free→paid conversion at entity cap. Current: n/a. Target: 📊 TBD. Method: Stripe + analytics. Frequency: monthly.
2. **KPI**: 30/90-day retention. Target: 📊 TBD.

### User Experience KPIs

- **Task completion**: >90% for core flows (testing).
- **Time to First Value**: first reminder fires same day.
- **Recall wins**: cross-session recall events/week.

### System Performance KPIs

- **Chat read latency**: ~1ms cache fetch. **Reminder latency**: ≤5 min. **Availability**: chat never blocked by memory subsystem.

### Success Milestones

1. Phase 1 deployed; tray reminders verified end-to-end.
2. Phase 2 memory wins demonstrated.
3. Phase 3 goal dashboard + briefing live.

## Constraints & Assumptions

### Technical Constraints

- [x] Supabase Postgres from day one (no SQLite migration).
- [x] TypeScript end-to-end (strict).
- [x] `user_id` + RLS on every table.
- [x] Tray is a thin shell — no business logic, no direct DB access (post-Tauri).

### Business Constraints

- [x] Solo builder; scope-based phasing.
- [x] Payments via MealPrepForge LLC (DBA); Missouri.
- [ ] Budget figures: 📊 TBD.

### Assumptions

- [x] The owner provides daily usage data for memory to compound.
- [x] pgvector sufficient at per-user scale.
- [x] Entity cap is a credible paywall.

## Risk Assessment

### High Risk

1. **Risk**: Constraint adherence stays unreliable.
   - **Impact**: Undercuts trust thesis. **Probability**: Medium. **Mitigation**: dedicated constraint layer + pre-action check. **Contingency**: ship as best-effort v1; measure before marketing it.

### Medium Risk

1. **Risk**: Sentinel complexity before value proven. **Mitigation**: MVP (2a) first, Sentinel (2b) after validation.
2. **Risk**: Tauri signing/CI cost. **Mitigation**: accept one-time setup; CI produces both artifacts.

## Quality Gates

### Requirements Phase Quality Gates

- [x] Roles and use cases expanded via 5-pass discovery.
- [x] Requirements testable with acceptance criteria.
- [x] NFRs specified (perf, security, availability, accessibility).
- [x] Business rules defined (truth ownership, approval, zero-trust).
- [x] Aligned with Vision/Plan and the master blueprint.

### Approval Checklist

- [ ] Owner sign-off. [ ] Security review (before comms phase).

## Document Information

- **Created By**: Roy Love
- **Creation Date**: 2026-06-29
- **Version**: 1.0
- **Document Status**: Draft
- **Next Review Date**: Phase 2 kickoff

## Appendices

### Appendix B: Data Dictionary (summary)

Full schema in `04-Architecture.md` and `supabase/migrations/`. Key tables: `profiles`, `tasks`, `task_reminders`, `tool_permissions`, `conversation_messages` (built); `entity_profiles`, `memories`, `user_context`, `conversation_summaries`, `sentinel_context` (memory); `life_areas`, `goals`, `projects`, `daily_briefings` (goals); `integrations`, `email_metadata`, `calendar_events`, `approval_queue`, `audit_log` (comms); `detected_patterns` (proactive); `behavioral_constraints` (conditional).
