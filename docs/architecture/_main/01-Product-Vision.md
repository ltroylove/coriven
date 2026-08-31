---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: foundation-vision
status: Draft
domain: product
product:
  - "coriven"
tags: [coriven, life-os, memory, personal-assistant]
relateddocuments:
  - "02-Product-Plan.md"
  - "03-Business-Requirements.md"
  - "04-Architecture.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Coriven — Product Vision

> Source of truth: this document is synthesized from `docs/planning/2026-06-24-coriven-master-blueprint.md`. Where the blueprint and this doc diverge, the blueprint governs and this doc should be reconciled to it.

## Executive Summary

### Vision Statement

An AI personal assistant that genuinely knows you, manages your life around *why* things matter, and compounds in value the longer you use it.

### Mission Statement

Coriven is a **personal Life OS**: it organizes your life as a goal hierarchy (Life Area → Goal → Project → Task → Reminder), remembers your people, projects, and preferences across months, and proactively surfaces what you need before you ask. It exists because no task manager, chatbot, or notes app reasons over your life as a whole — they track *what*, never *why*.

### Product Elevator Pitch

Most assistants forget you the moment a conversation ends. Coriven doesn't. It builds a structured, timestamped memory of your people, projects, and decisions, ties every task to the goal it serves, and reaches you through a desktop tray and daily briefings without a browser open. The first week it feels useful; by month six it holds context that exists nowhere else — that compounding memory is the product.

## Strategic Alignment

### Business Objectives

Coriven launches as a personal tool for its owner and is engineered to become a product without a rewrite (API-first, auth and `user_id` from day one, Supabase multi-tenancy via RLS).

#### Primary Business Goal

- **Goal**: Validate that compounding memory drives retention and willingness to pay.
- **Measurement**: Free→paid conversion at the entity cap; 30/90-day retention. *(Targets: 📊 TO BE DETERMINED — requires beta data.)*
- **Timeline**: Through Phase 6 (Productization).

#### Secondary Business Goals

1. **Goal**: Prove daily-driver utility for a single power user (the owner) before broadening.
   - **Measurement**: Daily active use; reminders fired and acted on; briefings opened.
   - **Timeline**: Phases 1–3.

2. **Goal**: Establish a defensible differentiator (the Sentinel memory architecture + goal hierarchy + reliable behavioral constraints).
   - **Measurement**: Sister/Coke problems solved end-to-end; constraint adherence materially above the ~42.5% research baseline.
   - **Timeline**: Phases 2 and the conditional constraint layer.

### Market Opportunity

- **Total Addressable Market (TAM)**: 📊 TO BE DETERMINED — requires market research.
- **Serviceable Addressable Market (SAM)**: 📊 TO BE DETERMINED.
- **Serviceable Obtainable Market (SOM)**: 📊 TO BE DETERMINED.

#### Market Trends

- [x] AI adoption increasing; users now expect assistants with memory and tool use.
- [x] Technology maturity (LLM tool use, pgvector, serverless cron) makes a one-person build feasible.
- [ ] Regulatory drivers — not a primary factor for a personal-productivity product.

### Competitive Landscape

#### Direct Competitors

| Competitor | Strengths | Weaknesses | Our Advantage |
|---|---|---|---|
| Notion | Flexible, DIY structure | No real memory; organizes *what*, not *why*; manual | Goal hierarchy + automatic memory |
| Things / Todoist | Fast, focused task UX | No goals, no memory, no proactivity | Reasons over goals; proactive nudges |
| Motion | Auto-scheduling | No persistent semantic memory; no entity profiles | Memory that compounds; entity profiles |
| Mem | Persistent memory | No goal hierarchy, no approval-gated actions, no tray | Integrated Life OS, not just notes |
| ChatGPT / Claude | Strong reasoning | Memory is a black box; no proactivity; no tray reach | Structured, user-visible, correctable memory |

#### Indirect Competitors

Calendar apps, email clients, habit trackers, and pen-and-paper — each solving one slice. Coriven's bet is integration across slices under a single goal-aware memory.

#### Competitive Positioning

Organize by *why*, not *what*; make memory the moat. The early experience is good but not unique — **the six-month experience does not exist anywhere else.**

## Product Strategy

### Target Users

#### Primary User Persona

- **Name**: Roy (the owner)
- **Role**: Founder/operator running multiple efforts (incl. MealPrepForge)
- **Goals**: Keep life and projects organized around real goals; offload remembering; be nudged before things slip
- **Pain Points**: Context lost between tools and conversations; AI that forgets and that ignores "never do X" rules; task lists divorced from why they matter
- **AI Experience**: High — comfortable with AI tools and their failure modes
- **Technical Sophistication**: High — developer

#### Secondary User Personas (post-productization)

- **The overwhelmed professional** — wants goals + reminders + a trustworthy assistant; medium technical skill.
- **The quantified-self / planner enthusiast** — values memory, momentum, and weekly reviews.

### Value Propositions

#### For Primary Users

1. **Value**: It remembers your people and preferences without being told twice.
   - **Current State**: Re-explaining context to every assistant, every session.
   - **Future State**: "I'm visiting my sister" → Coriven knows it's Sarah in Denver and offers flights.
   - **Quantified Benefit**: Eliminates re-statement of standing context; recall regardless of recency.

2. **Value**: Every task connects to a goal, and the system tells you whether your actions serve your intentions.
   - **Current State**: Task lists with no link to why; goals quietly abandoned.
   - **Future State**: Momentum labels and stale-goal nudges keep intentions visible.
   - **Quantified Benefit**: Stalled goals surfaced automatically (14-day inactivity nudge).

3. **Value**: It reaches you without a browser — reminders, briefings, and approvals as native notifications.
   - **Current State**: Reminders trapped in apps you have to open.
   - **Future State**: Tray notifications fire with everything closed.

#### For Business/Organization

1. **Value**: A productizable asset from a personal tool.
   - **Impact**: New product line under MealPrepForge LLC (DBA) with subscription revenue.
   - **Timeline**: Realized at Phase 6.

### Core Product Principles

#### Design Principles

1. **AI does not own truth** — the assistant advises and queues; systems of record (calendar, email, Coriven's own DB) stay authoritative.
2. **Human approval for meaningful actions** — anything reaching the external world to change it requires explicit approval.
3. **Small, focused jobs** — independent, testable capabilities, not a fragile workflow monolith.
4. **Zero-trust inputs** — all external content is hostile; it can be summarized and proposed on, never directly invoke an action.
5. **Productization-friendly from day one** — API-first, auth from day one, `user_id` on every record.
6. **Value compounds** — every choice judged on the six-month experience, not the first run.

#### AI Ethics Principles

1. **Transparency**: Memory is user-visible and correctable via the `/memory` page; the audit log records every recommendation and action.
2. **Fairness**: Single-user personal data; no profiling of third parties beyond the user's own entity notes.
3. **Privacy**: Per-user RLS isolation; OAuth tokens encrypted (AES-256-GCM); email bodies not stored.
4. **Reliability**: Graceful degradation (Sentinel/Upstash failures never block chat).
5. **Human Oversight**: Approval gates on every external action; not an autonomous agent.

## Product Roadmap

### Version 1.0 (MVP) — Phase 1 (largely built)

#### Core Features

- [x] Task CRUD + UI, reminders (`task_reminders`), chat engine with tool use, tool-permission toggles, auth, Supabase schema + RLS.
- [x] Windows tray daemon firing reminder notifications.
- [ ] Remaining: fix `/api/tasks/due`; Vercel production deploy; replace Node.js tray with a Tauri (Windows + Mac) thin shell.

#### Success Metrics

- Daily use by the owner; a reminder set 2 min out fires within 5 min with the browser closed; Snooze/Dismiss work.

### Version 2.0 — Phases 2–3

#### Enhanced Features

- [ ] Persistent memory (entity profiles + pgvector + summaries), then the async Sentinel.
- [ ] Goal hierarchy, momentum, deterministic daily briefing.
- [ ] (Conditional) lightweight behavioral-constraint registry after memory ships.

#### Success Metrics

- Sister/Coke problems solved across sessions; briefing surfaces a goal and today's task; constraint adherence above baseline.

### Version 3.0+ — Phases 4–6

#### Advanced Features

- [ ] Communications intelligence (email triage, calendar, approval queue, n8n worker).
- [ ] Proactive intelligence (pattern detection, weekly review, cross-context queries).
- [ ] Productization (Stripe tiers, onboarding, PWA + Web Push).

### Feature Prioritization Framework

| Criterion | Weight | Description |
|---|---|---|
| Compounding value | 35% | Does it make month-six better? |
| User (owner) impact | 25% | Daily utility now |
| Differentiation | 20% | Does it build the moat? |
| Technical feasibility | 12% | Complexity/risk for a solo build |
| Productization leverage | 8% | Helps the personal→product path |

## Success Metrics & KPIs

### User Success Metrics

- **Time to First Value**: First task + reminder fired same day.
- **Engagement**: Daily active use; briefings opened; reminders acted on.
- **Memory wins**: Cross-session recall events (sister/Coke) per week.

### Business Success Metrics

- **Conversion**: Free→paid at the entity cap (primary paywall). *Target: 📊 TBD.*
- **Retention**: 30/90/365-day. *Targets: 📊 TBD.*
- **Cost per active user**: AI + infra. *Target: 📊 TBD.*

### AI Performance Metrics

- **Constraint adherence**: % of "never do X" rules respected (baseline ~42.5%; goal: materially higher).
- **Memory precision**: Relevant memories surfaced vs. noise.
- **Token/cost per turn**: Sentinel keeps the chat read at ~1ms cache fetch; main-model cost bounded.

## Go-to-Market Strategy

### Launch Strategy

- **Soft launch (Beta)**: Owner-only daily driver through Phases 1–3, then a small invite beta.
  - **Lifetime deal**: $199 one-time, first 200 signups.
  - **Free trial**: 7 days of Core, **no credit card at signup**; trial triggers contextually at the entity/reminder cap.
- **Public launch**: After Phase 6 productization; channels 📊 TBD.

### Pricing Strategy

- **Model**: Freemium; the **entity cap is the paywall**.
- **Tiers**: Free $0 (10 entities, 24h memory) · Core $12/mo (unlimited entities, 7-day memory, cross-device) · Pro $22/mo (30-day memory, unlimited reminders). Annual = 2 months free.
- **Value justification**: Conversion fires exactly when the user feels the value most — when Coriven can't remember any more.

### Customer Success Strategy

- **Onboarding**: 4-step wizard (Phase 6) creating a first goal + task.
- **Lifecycle**: Activation (first reminder fires) → engagement (briefings, nudges) → expansion (entity cap) → retention (compounding memory).

## Risk Analysis & Mitigation

### Market Risks

1. **Risk**: Incumbents add memory faster.
   - **Impact**: Erodes differentiation. **Probability**: Medium.
   - **Mitigation**: Lead with the Sentinel + goal hierarchy + constraint adherence combination, which is unnamed in literature.

### Technology Risks

1. **Risk**: Behavioral-constraint adherence stays unreliable.
   - **Impact**: Undercuts the trust thesis. **Probability**: Medium.
   - **Mitigation**: Dedicated constraint layer + pre-action check; treat as a research bet, not a guarantee (§19 decision).

2. **Risk**: Sentinel latency/availability harms chat.
   - **Impact**: Degraded experience. **Probability**: Low–Medium.
   - **Mitigation**: Async design; Supabase fallback; previous-package fallback; failures never block.

### Business Risks

1. **Risk**: Solo build velocity / scope creep.
   - **Impact**: Slips. **Probability**: Medium.
   - **Mitigation**: Strict phasing; each phase independently shippable; deferred features parked in §18 of the blueprint.

## Assumptions & Dependencies

### Key Assumptions

- [x] The owner will use it daily and provide the behavioral data memory needs.
- [x] pgvector is sufficient at per-user scale (<100k rows); graph DB deferred.
- [x] The entity cap is a credible primary paywall.
- [ ] Beta users will pay $12/$22 — unvalidated.

### Critical Dependencies

- [ ] Anthropic Claude API (chat + extraction).
- [ ] Supabase (Postgres, Auth, RLS, pgvector).
- [ ] OpenAI embeddings (`text-embedding-3-small`) — accepted as a second AI vendor (§19.7).
- [ ] Upstash Redis (Sentinel phase); Vercel (hosting + cron); Stripe via MealPrepForge DBA (productization).

## Document Information

- **Created By**: Roy Love
- **Creation Date**: 2026-06-29
- **Version**: 1.0
- **Approval Status**: Draft
- **Next Review Date**: At Phase 2 kickoff
