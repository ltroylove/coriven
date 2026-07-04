# Coriven — Master Product & Architecture Blueprint

**Date:** 2026-06-24
**Status:** Active — master reference. Consolidates all prior planning, research, and vision documents into one source of truth.
**Supersedes (as the canonical reference):** All documents listed in §0.2. Those remain as historical record; this document is what we build the implementation plan from.

---

## 0. Purpose & Provenance

### 0.1 What This Document Is

This is the single, comprehensive reference for **Coriven** — what it is, why it exists, how it is architected, what gets built in what order, and how it makes money. It is written to be the input to the **build plan** (the step-by-step implementation guide that comes next). It is intentionally detailed and self-contained: a developer or planner should not need to read the source documents to understand the system.

Where prior documents disagreed, this document reconciles them and states the resolution. Where a genuine product decision remains open, it is captured in **§19 Open Decisions** rather than silently decided.

### 0.2 Source Documents Consolidated

| Source | Contribution to this blueprint |
|--------|-------------------------------|
| `docs/Personal AI Assistant Platform.docx` (ChatGPT collaboration PRD, v1.0) | Original Life-OS vision, goal hierarchy, jobs-to-be-done, zero-trust security, medication tracking, daily briefing |
| `docs/Technical Stack & n8n Architecture Decision.docx` | n8n-as-worker boundary, model routing, original local-first stack (later revised) |
| `docs/Personal-Assistant-Vision.md` | Coriven narrative vision — the Sentinel, entity profiles, the day-in-the-life, the bigger decision-modeling vision |
| `docs/planning/decisions.md` | Locked architectural decisions (Supabase from day one, TypeScript, per-tool opt-in) |
| `docs/planning/2026-06-19-personal-assistant-design.md` | Concrete first-milestone architecture, data model, tray daemon design |
| `docs/planning/2026-06-19-implementation-plan.md` | Original 8-phase build sequence |
| `docs/planning/2026-06-20-merge-reminders-into-tasks.md` | Reminders folded into the `tasks` table |
| `docs/planning/2026-06-20-unified-vision.md` | The prior master synthesis — full data model, tool registry, phases 1–6 |
| `docs/planning/2026-06-20-memory-mvp.md` | Simple memory MVP (entity profiles + pgvector + summaries) |
| `docs/planning/2026-06-20-phase2-memory-sentinel.md` | Full async Sentinel + Upstash implementation plan |
| `docs/planning/2026-06-24-architecture-additions.md` | Entity aliases, temporal tracking, RESOURCE type, momentum formula, monetization tiers |
| `docs/research/2026-06-20-ai-memory-research.md` | Memory state-of-the-art; the behavioral-constraint compliance problem |
| `docs/research/2026-06-20-ai-memory-research-2-entity-proactive-causal.md` | Entity-centric memory, bi-temporal graphs, proactive surfacing, the causal-modeling frontier |
| `docs/research/2026-06-20-sentinel-context-architecture.md` | The Sentinel concept and its prior-art analysis |

### 0.3 How To Use This Document

- **For the build plan:** Sections 4–14 define the system to be built. Section 17 sequences it. Section 19 lists what must be decided first.
- **For product/business:** Sections 1–3 and 16.
- **For onboarding a new contributor:** Read 1, 2, 4, 6, 7 in order.

### 0.4 Document Authority — Recency Wins

This project has been planned across several iterations. **When two source documents conflict, the more recent document wins.** The earlier document is treated as superseded on that specific point, not as an equal vote. This blueprint applies that rule throughout; the precedence order (highest authority first) is:

1. **2026-06-24** — `architecture-additions.md` (entity aliases, temporal tracking, RESOURCE type, momentum formula, monetization tiers) and this blueprint
2. **2026-06-23** — Coriven naming + business structure (MealPrepForge LLC / DBA, Stripe)
3. **2026-06-22** — `Personal-Assistant-Vision.md` (the Sentinel-centric narrative vision)
4. **2026-06-20** — `unified-vision.md`, `memory-mvp.md`, `phase2-memory-sentinel.md`, `merge-reminders-into-tasks.md`, the three research reports
5. **2026-06-19** — `2026-06-19-personal-assistant-design.md`, `implementation-plan.md`, `decisions.md`
6. **Undated (original)** — `Personal AI Assistant Platform.docx`, `Technical Stack & n8n Architecture Decision.docx` (ChatGPT-collaboration era)

Concrete consequences of applying recency authority (each resolved in this blueprint):

- **Reminders live in a separate `task_reminders` table** (as-built). The 2026-06-20 "merge into tasks" plan was written but never executed; we keep the working separate table rather than refactor it (corrected 2026-06-24 — see §7.4).
- **The Sentinel is the target memory architecture** — the 2026-06-22 vision and 2026-06-24 additions elevate it above the simpler always-in-prompt MVP; the MVP is reframed as the first increment toward it (§6.5).
- **Supabase + pgvector**, not SQLite or a dedicated vector DB — the 2026-06-19 decisions log supersedes the original `.docx` local-first/SQLite direction.
- **Monetization tiers and the DBA business structure** (2026-06-23/24) are canonical over any earlier pricing silence.
- **The goal hierarchy and phase model** follow the 2026-06-20 unified vision, extended (not replaced) by the 2026-06-24 additions.

Where an *older* document is the only source for something and nothing newer contradicts it, it still stands (e.g., the zero-trust security model and n8n boundary from the original `.docx` are retained because every later document is consistent with them).

---

## 1. Product Thesis

### 1.1 What Coriven Is

Coriven is a **personal Life OS** — an AI assistant that genuinely knows you, manages your life, and compounds in value the longer you use it. It is not a task manager, not a chatbot, and not a notes app. The distinction drives every product decision:

- A task manager is a list. Coriven is a **reasoning engine over your life**.
- A chatbot answers questions. Coriven **proactively surfaces what you need to know before you ask**.
- A notes app stores what you type. Coriven **extracts meaning** from your interactions and remembers it structurally.

The organizing principle is **goal hierarchy**: everything in the system connects upward to a reason it exists.

```
Life Area  →  Goal  →  Project  →  Task  →  Reminder / Event
  Health        Lose       Gym           Go to        Tuesday
                100 lbs     Routine       the gym      7am
```

No tier-1 competitor (Notion, Things, Todoist, Motion, Mem) organizes around *why* — only *what*. The goal hierarchy creates a feedback loop: the system can tell you whether your **actions** are actually serving your **intentions**.

### 1.2 What Coriven Is Not

Drawn directly from the original PRD's "What This Is Not," preserved as hard product boundaries:

- **Not an autonomous agent.** It advises, recommends, summarizes, reminds, and drafts. Humans remain responsible for decisions.
- **Not a workflow engine.** Automation (n8n) is a replaceable execution component, never the core.
- **Not a replacement for human judgment.** It surfaces and recommends; the user decides.
- **Not a system that blindly executes instructions** — especially not instructions originating from untrusted content (email, web, documents).
- **Not a business-intelligence tool.** Entities are personal — the people, places, and projects in *your* life.
- **Not a system optimized to impress on day one** at the cost of long-term value.

### 1.3 The Wedge and the Compounding Bet

Coriven launches as a **task + reminder + chat** product (already built — see §17.1) and expands outward. But the strategic bet is **memory that compounds**:

- **Day 1:** Behaves like any AI assistant — no context, starts from zero.
- **Week 1:** Knows your people, projects, and preferences.
- **Month 1:** Knows how you think.
- **Month 6+:** Holds a structured, timestamped record of how you decide and behave — the substrate for capabilities that do not exist in any product today (see §6.7 behavioral constraints, §12.4 proactive surfacing, and the long-horizon decision-modeling vision in §18.6).

The personal assistant is the wedge. The memory/Sentinel layer is what makes it worth building.

### 1.4 End-State Feature Set

From the earliest decisions, the end-state spans three pillars:

- **A) Life & schedule management** — reminders, calendar, tasks, daily briefings.
- **B) Knowledge & research companion** — answers questions, summarizes, remembers context.
- **C) Automation hub** — runs workflows, talks to APIs, acts on the user's behalf (under approval).

The build order starts in pillar A/C (task + reminder engine), layers in memory (B), then communications and proactivity.

---

## 2. Core Philosophy & Principles

These principles are non-negotiable. They originate in the PRD and the decisions log and are binding on every design choice.

### 2.1 AI Does Not Own Truth

The assistant reads, interprets, suggests, and acts — but never becomes the system of record.

- **Calendar** owns appointments.
- **Email** owns messages.
- **Task Manager (Coriven's own DB)** owns tasks.
- **Medication tracker** (if built) owns medication history.

Consequence: AI output is always advisory or queued for approval. It never silently mutates an external system of record.

### 2.2 Human Approval Required for Meaningful Actions

Every action that reaches into the external world and changes something requires explicit user approval. Everything inside the assistant's own domain is auto-owned. See §9 for the full tier model. The rule in one line:

> If it stays inside the assistant's own domain, no approval needed. If it reaches into the external world and changes something, approval is required. No exceptions.

### 2.3 Small, Focused Jobs (Not a Monolith)

The assistant is composed of independent, testable capabilities — **not** massive workflow chains. This is the explicit lesson from the n8n discussion: trying to build everything as workflow nodes becomes "a fragile 1,000-node monster."

Capabilities (each independently testable): Email Intelligence, Calendar Intelligence, Daily Briefings, Research Assistant, Project/Goal Tracking, Meeting Preparation, Personal Memory, Notifications.

### 2.4 Zero-Trust Inputs

All external content — email, websites, documents, messages, API responses — is treated as hostile. No external source may issue commands. Untrusted content can be summarized and proposed on, but can never directly invoke an action. This is the security spine of the whole system (see §9.3).

### 2.5 Productization-Friendly From Day One

Every choice is made so that going from "personal tool" to "product" is a config change, not a rewrite:

- **API-first** — the UI always calls a backend API, never touches data directly.
- **Auth from day one** — a login layer exists even for a single user.
- **`user_id` on every record** — multi-tenancy is already done via RLS.
- **Supabase Postgres from day one** — no SQLite migration later.
- **Web-first UI** — browser today → PWA for mobile → Tauri desktop later.

### 2.6 Value Compounds

Every design choice is judged against whether it makes the system more valuable over months of use, not just impressive on first run. Memory that accumulates, entity profiles that enrich, goals that track momentum — all chosen because the six-month experience is the moat.

---

## 3. Differentiation

### 3.1 Competitive Comparison

| Capability | Coriven | Notion | Things / Todoist | Motion | Mem | ChatGPT / Claude |
|---|---|---|---|---|---|---|
| Goal hierarchy (Life Area→Goal→Project→Task) | Yes | Partial (DIY) | No | No | No | No |
| Persistent semantic memory | Yes | No | No | No | Yes | Partial (black box) |
| Entity profiles (people/places/projects) | Yes | No | No | No | No | No |
| Async Sentinel building context continuously | Yes — novel | No | No | No | No | Unknown |
| Email triage built-in | Yes (Ph. comms) | No | No | No | No | No |
| Approval gates on every external action | Yes | No | No | No | No | No |
| Daily briefing from goals + tasks + email | Yes | No | No | No | No | No |
| Proactive nudges on stale goals | Yes | No | No | No | No | No |
| Tray notifications without a browser open | Yes | No | No | No | No | No |
| Organizes by *why*, not just *what* | Yes | No | No | No | No | No |
| Value that compounds over months | Yes | No | No | No | Partial | Partial |

### 3.2 The Genuinely Novel Parts

Three things, in combination, do not exist in any shipping product:

1. **The Sentinel context architecture** (§6.4). An async background agent that controls 100% of the main model's context, reads from persistent stores rather than a context window, and pre-builds context before the next message. Research (`sentinel-context-architecture.md`) confirmed the five-part combination is unnamed in literature as of mid-2026.

2. **Goal hierarchy at this integration level** (§7). Organizing around *why* while simultaneously triaging email, maintaining memory, and generating briefings from the combined context.

3. **The behavioral-constraint opportunity** (§6.7). The best available memory system achieves only **42.5% compliance** with "never do X" rules even when the rule is retrieved. No product has solved this. Reliable constraint adherence would be a meaningful first.

### 3.3 The Honest Framing

The early experience is good but not unique. **The six-month experience doesn't exist anywhere else.** That is the bet, and the architecture is designed to deliver it.

---

## 4. System Architecture

### 4.1 Process & Deployment Diagram

```
Your Machine (Windows)                  Cloud (Vercel + Supabase + Upstash)
┌─────────────────────────┐            ┌──────────────────────────────────────┐
│                         │            │                                      │
│  Tray App (Tauri)       │            │  Next.js App (App Router)            │
│  - Polls /api/tasks/due │──HTTPS────▶│  - Web UI (React)                    │
│    every 5 min          │            │  - API Routes (/api/*)               │
│  - Fires toast notifs   │            │  - Server Actions                    │
│  - Snooze / Dismiss     │            │  - Chat Engine (Claude + tools)      │
│                         │            │  - Sentinel job (async memory)       │
│  Browser                │──HTTPS────▶│                                      │
│  (same Vercel URL)      │            │  Supabase                            │
│                         │            │  - Postgres (all tables)             │
└─────────────────────────┘            │  - Auth (email/password + sessions)  │
                                       │  - RLS (user_id isolation)           │
                                       │  - pgvector (memory embeddings)      │
                                       │                                      │
                                       │  Upstash Redis                       │
                                       │  - Sentinel context cache (TTL)      │
                                       │                                      │
                                       │  Vercel Cron Jobs                    │
                                       │  - Daily briefing (7am)              │
                                       │  - Email poll (every 15 min, comms)  │
                                       │  - Pattern detection (nightly)       │
                                       └──────────────────┬───────────────────┘
                                                          │
                                               Approved actions only
                                                          │
                                       ┌──────────────────▼───────────────────┐
                                       │  n8n (comms phase, self-hosted)      │
                                       │  Execution worker — never triggered  │
                                       │  directly by untrusted content       │
                                       │  - Send approved email               │
                                       │  - Write calendar event              │
                                       │  - Third-party integration glue      │
                                       └──────────────────────────────────────┘
```

### 4.2 The Two Processes

- **Next.js app (cloud, Vercel):** Web UI + API routes + Server Actions + the Claude chat engine + the Sentinel job. The brain and the surface.
- **Tray app (local, Windows + Mac):** A lightweight **Tauri** app that starts on login, polls the API for due reminders/briefings/approvals, and fires native notifications. No primary window — a tray icon only. This is how the system reaches the user without a browser open. It is a thin shell: all logic lives in the backend API (§13). Replaces the prior Node.js daemon.

### 4.3 The "AI Does Not Own Truth" Boundary (Architecturally Enforced)

External systems of record (Gmail, Google Calendar) are read through integrations and represented in Coriven only as **metadata/snapshots** — never as the canonical copy. Writes back to them go exclusively through the approval queue → n8n path. Coriven's own Postgres is authoritative only for the data Coriven owns (tasks, goals, entities, memories, approvals, audit).

### 4.4 The n8n Boundary (Worker, Not Backbone)

The conclusion from the tech-stack discussion, preserved verbatim in spirit:

> n8n is useful. n8n is not the product. The personal assistant is the product. n8n is one replaceable component inside it.

The security invariant:

```
Untrusted input → Claude (summarize / propose) → User approval → n8n executes
```

n8n receives a webhook **only after** `approval_queue.status = 'approved'` by an authenticated user action. The payload is a pre-validated action descriptor, never raw content or raw AI output. n8n decides nothing; it executes a known, approved job. Swapping n8n for direct API calls later changes no assistant code.

### 4.5 Monorepo Structure

```
apps/
  web/                   ← Next.js 15 (UI + API) → Vercel
    src/
      app/
        (app)/           ← Authenticated routes: tasks, chat, goals, memory,
                            email, approvals, settings
        api/             ← API routes (tasks, chat, sentinel, cron, tools, ...)
        auth/            ← Sign-in
        actions/         ← Server Actions
      components/        ← Shared UI
      lib/
        supabase/        ← 4 client variants (browser, auth-client, server, auth-server)
        anthropic.ts     ← Model constants, client init
        chat/
          engine.ts      ← Core chat loop (Claude + tool use)
          tools/
            registry.ts  ← Tool definitions (grows each phase)
            handlers/    ← One file/handler per tool
        memory/          ← embed, extract, store, cache, build-context, sentinel
        jobs/            ← briefing generation, pattern detection
      types/
        supabase.ts      ← Auto-generated
  tray/                  ← Tauri app → Windows .exe + Mac .app (thin shell over the API)
    src/                 ← webview frontend: auth, poll endpoints, render notifications
    src-tauri/           ← Rust core: native tray icon, native notifications,
                            autostart plugin, secure session storage
    (replaces the prior Node.js daemon — removed once Tauri reaches parity)
packages/
  types/                 ← Shared TypeScript types (task, tool, memory, goal, ...)
supabase/
  migrations/            ← SQL-first, one file per migration
docs/
  planning/  research/   ← Design docs
```

---

## 5. Tech Stack

### 5.1 The Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 15 (App Router) | API routes + React in one repo; same as MealPrepForge |
| Language | TypeScript (strict everywhere) | One language end-to-end; strong typing aids agentic development; large training corpus |
| Styling | Tailwind CSS 4 | Same as MealPrepForge; no component library yet (shadcn/ui can layer in later) |
| Database | Supabase (Postgres) | Managed, scales, built-in Auth + RLS; **from day one, no SQLite** |
| Auth | Supabase Auth + SSR | 4-client pattern (browser, auth-client, server, auth-server) |
| Vector store | pgvector (in Supabase) | Same stack, same RLS, no new vendor; `text-embedding-3-small` (1536 dims) |
| Context cache | Upstash Redis (serverless) | Edge-deployed, TTL-bounded Sentinel context cache |
| AI — main | Anthropic Claude Sonnet (`claude-sonnet-4-6`) | Reasoning + tool use for the chat engine |
| AI — extraction | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) | Cheap, fast memory/entity extraction in the Sentinel |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dims, ~$0.02/1M tokens — far cheaper than Claude embeddings |
| Hosting (web) | Vercel | Same account as MealPrepForge; auto-deploy from `main` |
| Tray | **Tauri** (Rust core + system webview) | Single codebase → Windows `.exe` + Mac `.app`; native tray + notifications. Thin shell over the API (logic lives server-side). Replaces the prior Node.js daemon (decided 2026-06-24) |
| Automation | n8n (self-hosted, comms phase) | Execution worker for approved external actions only |
| Payments | Stripe (MealPrepForge LLC / DBA) | See §16 |

### 5.2 Model Routing

Following the original tech-stack guidance ("model routing based on job type"):

- **Haiku (fast/cheap):** memory extraction, entity classification, email triage batch, simple deterministic tool ops.
- **Sonnet (smart):** main chat reasoning, multi-step tool chains, anything user-facing and nuanced.
- **Embeddings (OpenAI):** all vector embedding, separate from chat models.

### 5.3 Rejected Alternatives (and Why)

| Considered | Rejected in favor of | Reason |
|------------|---------------------|--------|
| SQLite / local-first | Supabase from day one | Avoids a painful migration at productization; RLS multi-tenancy free |
| Pinecone / Weaviate / Qdrant / Chroma / LanceDB | pgvector | Adds a vendor, loses RLS guarantees, adds latency and cost; pgvector is fast enough at per-user scale (<100k rows) |
| Neo4j / Graphiti graph DB (now) | pgvector + entity-profile table (now) | Graph gives ~80% of value at 5% of complexity for the MVP; revisit for bi-temporal evolution later (§6.5, §18.5) |
| Node.js daemon / Electron (tray) | **Tauri now** (decided 2026-06-24) | A Tauri port would rewrite ~100% of the Node.js daemon; rather than build tray features twice, go straight to Tauri (lighter than Electron) and get Mac for free. The reusable logic lives in the API, not the shell, so the shell is cheap and disposable |
| n8n as backbone | n8n as replaceable worker | A workflow-only architecture becomes a fragile 1,000-node monster; core logic belongs in the app |
| Python/FastAPI backend | TypeScript end-to-end | One language; the hybrid TS-app/Python-AI split wasn't worth the operational complexity |
| OpenAI / Ollama as main model | Claude (Anthropic) | Tool use + reasoning quality; Anthropic is the chosen provider. (Local Ollama remains a deferred privacy option — §18.4) |

---

## 6. The Memory System (The Heart)

Memory is what makes Coriven worth building. Everything else is table stakes. This section is the most important in the blueprint.

### 6.1 The Problems Memory Has To Solve

Three canonical problems, drawn from the vision and research docs, define the bar:

- **The sister problem.** You say "my sister Sarah lives in Denver" in January. In March you say "I'm visiting my sister." Coriven should respond *"Want me to look at flights to Denver?"* — without being told again, and without the word "Denver" appearing in your message.
- **The Coke/Pepsi problem.** You say "I prefer Coke over Pepsi" in January. In March you say "I need to order a drink." Coriven should know you want Coke — even though that preference is thousands of messages back.
- **The context-cliff problem.** Every "last-N-messages" system has a sliding cliff edge: anything important said before the window falls off. Retrieval helps only if the query happens to match. Neither is reliable on its own.

The unifying requirement: **the right knowledge must be present at the right moment, regardless of how long ago it was learned.**

### 6.2 Research Foundation — What's Validated, What Isn't

From the two deep-research reports (adversarially verified, 3-vote system). This grounds our choices in evidence and flags what not to trust.

**Validated and adopted:**
- **LLM-driven memory updates (Mem0 pattern).** An LLM classifies each new fact as ADD / UPDATE / DELETE / NOOP against the top-k semantically similar existing memories — more robust than a separate trained classifier. *We adopt this mechanism.*
- **Entity-centric memory with rich profiles.** Store named entities with full natural-language descriptions ("Sarah — Roy's sister, lives in Denver, last mentioned January"), not bare names or isolated facts. *This is our entity-profile layer.*
- **Layered memory: stable profile cache + episodic retrieval.** A small always-in-context profile of stable facts, plus an episodic store retrieved on demand. *This is our three-layer model (§6.3).*
- **Episodic memory requires reasoning, not just retrieval.** The sister problem needs the model to *reason* over the entity graph ("visiting my sister → Sarah → Denver → flights"), not just similarity-match. *This is why entity profiles sit always-in-context, where the model can reason over them.*
- **Bi-temporal contradiction handling — update/invalidate, don't delete.** When a fact changes, mark the old one superseded with a date; keep it historically queryable. *We adopt a simplified version now (`superseded_by` FK) and the full bi-temporal model later (§6.5, §18.5).*

**Explicitly NOT trusted (failed verification):**
- Performance benchmark numbers from system papers (token-savings %, latency %, accuracy gains) — almost universally failed adversarial verification. We do not design around any specific benchmark claim.
- Elaborate typed-memory schemas (13-category taxonomies) and multi-strategy retrieval fusion claims — unproven; we keep storage simple.
- Graph-DB superiority claims — directionally interesting but unproven gains over vector retrieval at our scale; hence pgvector now.

**The single most important finding** is the behavioral-constraint compliance problem — see §6.7.

### 6.3 The Three-Layer Memory Model

This is the implementable core, valid today.

**Layer 1 — Entity Profiles (always in context).**
A small, structured store of the people, places, projects, and things in the user's life. Loaded on *every* request — not retrieved, always present. This is what the model reasons over for the sister problem. Target: keep the whole block under ~500 tokens; it must earn its place in the prompt. Stays current via tool-call updates: when Sarah moves, the profile notes "was Denver, now Austin as of Jun 2026."

**Layer 2 — Semantic Memory (retrieved by similarity).**
The `memories` table with pgvector. Facts that don't belong in the always-on profile — specific events, one-off details, preferences stated once. Retrieved by cosine similarity on each message. Uses the Mem0 ADD/UPDATE/DELETE/NOOP mechanism. On contradiction, the old memory is marked `superseded_by` the new one rather than deleted — old facts stop being retrieved by default but remain queryable.

**Layer 3 — Conversation Summaries (continuity).**
After ~20 turns or at session end, generate a summary. Inject the last 2–3 summaries as context to provide continuity across sessions without re-reading full history.

**System-prompt assembly (what the main model sees):**
```
## What I know about you

### People, places & projects in your life:
- Sarah: your sister, lives in Denver
- Mom: lives in Phoenix, recovering from hip surgery (March 2026)
- MealPrepForge: your business — you've asked me not to modify its code

### Things I've learned about you:
- [top ~5 semantically similar memories to the current message]

### Recent context (last 2–3 session summaries):
- [summary 1] [summary 2]
```

### 6.4 The Sentinel — The Target Architecture

The three-layer model answers *what* to store. The **Sentinel** answers *how context gets assembled* — and it is the genuinely novel piece (§3.2).

**Core insight:** The Sentinel doesn't have a context-window problem because it doesn't use a context window — **it reads from a database.** The full message log, entity profiles, vector memories, summaries all live in persistent storage. The Sentinel *searches* them; it never scrolls back through a transcript. Its input is the entire history of the user, accessed as data; its output is bounded.

**The main model never sees raw conversation history.** It receives a curated context package — a structured synthesis of everything the Sentinel judged relevant to the current moment, plus the last 3–5 turns verbatim for immediate coherence. The Sentinel *is* the memory system; it decides what the main model needs to know.

**Flow:**
```
User sends message
   ↓
Sentinel receives it immediately — works async (does NOT block the response)
   ├─ Extract: new entities, facts, preferences, signals → save to stores
   ├─ Query: search all stores for what's relevant to the current state
   ├─ Judge: what to include; compress what's no longer active; expand what's newly relevant
   └─ Build: assemble the context package → write to Upstash (and Supabase fallback)
   ↓
Main model gets the pre-built package → responds immediately
   ↓
Sentinel fires again on the assistant's response → builds the next package
```

**Latency reality:** Human conversation has 15s–minutes between messages. A Haiku-class Sentinel builds a package in ~2–5s, so it's almost always ready before the next message. Fallback for rapid-fire replies: use the previous package (slightly stale for one turn). Long gaps are an opportunity for deeper compression/pattern work.

**Compression AND expansion:** The package is a living synthesis, not a growing list. When a topic resolves, the Sentinel drops it from the package (the data stays in storage — it just stops costing tokens). When a new topic emerges, it expands. This subtractive-as-well-as-additive behavior is part of what makes the architecture novel.

**Integration contract (hard requirement):** The chat route MUST read the context package before generating a response. A Sentinel that writes context the chat never reads is dead code. Verified explicitly during testing (§13 of the source plan; carried into §17 phasing here).

**Fail gracefully:** If Upstash is unavailable, the Sentinel logs and continues; chat falls back to the Supabase-persisted package, then to session context. Sentinel failure never blocks the user.

**No LLM in the chat's read path:** The Sentinel does the LLM work (extraction) asynchronously; the chat read is a ~1ms cache fetch. The only main-model call is the user-facing response.

### 6.5 MVP → Sentinel → Graph: The Build Path

The two 2026-06-20 memory docs are not competing designs — they are **two points on one path.** Reconciled here (recency favors the Sentinel as the target):

| Stage | What ships | Storage | Context assembly |
|-------|-----------|---------|------------------|
| **6.5.a — Memory MVP** | Entity profiles always in prompt + pgvector semantic recall + summaries. `upsert_entity` / `save_memory` tools. `/memory` management page. | Supabase (`entity_profiles`, `memories`, `conversation_summaries`) | Synchronous: chat engine assembles context inline before each Claude call. No Sentinel, no Upstash. |
| **6.5.b — Sentinel** | Async extraction (Haiku), pre-built context packages, Upstash cache with Supabase fallback, fires on user AND assistant messages. | + Upstash Redis (`sentinel:context:{user_id}`, TTL); + `sentinel_context` table (fallback) | Async: Sentinel builds package; chat reads cache (~1ms). Main model stops seeing raw history. |
| **6.5.c — Bi-temporal / graph (future)** | Full entity graph, relationship traversal, four-timestamp bi-temporal edges (Graphiti-style), historical queries ("where did Sarah live in January?"). | Evaluate graph store or pgvector + relationship tables | Sentinel traverses the graph during the judge step. |

**Why this order:** The MVP delivers the sister/Coke wins with the least machinery and validates the value. The Sentinel removes the context-cliff entirely and is the differentiator. The graph layer is deferred until real usage data justifies its complexity (research confirmed it's the right *long-term* direction, not the right *now* direction).

### 6.6 Entity Model

**Entity types:** `person`, `place`, `project`, `thing`, `resource`.
- `resource` (added 2026-06-24) covers tools, subscriptions, and accounts (e.g., "Notion," "Netflix," "AWS account").
- The original wider taxonomy (GOAL, TASK, LIFE_AREA as entity types) is **not** used — goals/tasks/life-areas are first-class tables in the goal hierarchy (§7), not entity-profile rows. This avoids duplication.

**Aliases + resolution (2026-06-24).** "Mom," "Tara Love," "my mother" all resolve to one entity. Resolution order:
1. Exact match on `name`
2. Exact match on any `aliases[]` entry
3. Fuzzy match (Levenshtein distance ≤ 2) on name and aliases
4. Contextual disambiguation when two candidates score similarly
When the user uses a new name for an existing entity, Coriven confirms or auto-adds to `aliases` after two successful resolutions.

**Temporal tracking (2026-06-24).** Each entity tracks `last_mentioned`, `mention_count`, and `recency_weight`. `recency_weight` decays 10% per week without mention (decay runs in the daily-briefing cron) and resets toward 1.0 on mention. Higher weight = more likely to surface unprompted in the briefing.

**Profile content:** relationships, locations, recurring projects, key preferences — stable, important things. Each profile is a short natural-language description plus typed fields where useful.

See §14 for the exact schema.

### 6.7 The Behavioral-Constraint Layer (Strategic Opportunity)

**This is the single most important research finding, and it is not yet in any build plan.** Flagged here as a first-class design consideration; the decision on whether/when to build it is in §19.

**The problem.** "Never do X" rules have no reliable enforcement mechanism in any current memory system. The best available system (Mem0) achieves only **~42.5% compliance even when the relevant rule is successfully retrieved.** The AI retrieves the rule, "reads" it, and still violates it more than half the time. Root cause is **utility-induced drift**: a goal-directed model treats constraints as soft costs to route around when they conflict with task success. This is an optimization problem, not a retrieval problem — better retrieval makes the rule more visible but does not change the dynamic.

**Why it matters to us specifically.** This is the MealPrepForge problem stated scientifically: an AI told repeatedly "don't modify my website code" retrieves that instruction and still violates it. Coriven's entire premise is *trust that compounds*. A system that respects what you've told it to never do — reliably, not 42.5% of the time — would be a genuine first in the space.

**What the research says would actually work (theoretical, unvalidated — the opportunity):**
- A **dedicated constraint layer** stored and retrieved differently from factual memories (a rule is not the same kind of thing as "the dog's name is Biscuit").
- **Pre-action checking:** before any tool call, an explicit check — "does this action violate a stored constraint?" — separate from semantic retrieval.
- **Richly encoded constraints (the *why* matters):** not "don't modify the website" but the full context and reason, which is harder to rationalize around.
- **A user-authored, user-visible constraint registry:** the user deliberately writes and locks rules (different weight than the AI inferring them).
- **Post-generation violation detection:** a lightweight secondary check — "did I just violate a known constraint?"

**Relationship to existing design.** `tool_permissions` (already built) enables/disables tools wholesale but cannot encode nuanced rules ("use this tool but not for that kind of task"). The constraint layer is a complement, not a replacement. See §19 for the open decision on scope and timing.

---

## 7. Goal Hierarchy

### 7.1 The Hierarchy

The structural backbone of the Life OS. Everything connects upward to a reason it exists.

```
Life Area  →  Goal  →  Project  →  Task  →  Reminder / Event
```

- **Life Area** — high-level life domain (Health, Career, Family, Finance).
- **Goal** — a measurable outcome with a `why_it_matters` (forced articulation) and `success_metrics`.
- **Project** — a group of related tasks under a goal (a goal isn't required for a project).
- **Task** — an actionable to-do (optionally linked to a project and/or goal). Tasks carry their own reminder fields (§7.4).
- **Reminder / Event** — a scheduled notification (now a property of a task, not a separate entity).

The AI spends most of its reasoning at the **Goal and Project** levels; deterministic systems handle Tasks and Events. This is the architecture intended to "still make sense 10 years from now instead of becoming just another task manager with an LLM bolted on."

### 7.2 Goal Health Model

Each goal carries (from the PRD's goal-health model): **Status, Trend, Confidence, Risk, Momentum, Priority**, plus contributing factors and concerns surfaced by the AI. In the implemented schema this is captured by `status` (active/achieved/paused/abandoned), `confidence` (high/medium/low), and `momentum` (improving/stable/declining), with the richer factors expressed in AI-generated summaries and the daily briefing.

### 7.3 Momentum Formula (2026-06-24)

The concrete calculation behind the improving/stable/declining label:

```
momentum_score = (tasks_completed_last_7d − tasks_created_last_7d) / max(tasks_created_last_7d, 1)

improving → momentum_score >  0.2
declining → momentum_score < −0.2
stalled   → −0.2 ≤ momentum_score ≤ 0.2
```

**Stale-goal nudge:** a goal with zero task activity for 14 consecutive days triggers a Coriven-initiated nudge in the daily briefing (separate from the momentum label), firing once per 7-day period until activity resumes.

**Implementation:** recalculated nightly in the briefing cron; the result is written to `goals.momentum`. No real-time computation.

### 7.4 Reminders Are a Separate `task_reminders` Table (As-Built)

**Correction (2026-06-24):** The 2026-06-20 "merge reminders into tasks" plan was written but **never executed**, and we are not executing it — refactoring working code for marginal benefit violates the don't-rebuild-what-works principle. The as-built schema (migration `20260620140813_add_task_reminders_table.sql`) uses a separate **`task_reminders`** table with a `task_id` FK, carrying `remind_at`, `snoozed_until`, `recurrence_type` (`none|daily|weekdays|weekly|monthly|yearly`), `recurrence_end_at`, and `last_fired_at`. The tray polls `/api/tasks/due`; `/api/tasks/[id]/snooze` handles snoozing; `getNextOccurrence()` in `packages/types` computes recurrence (it should be the single source — the tray must not re-implement it). A task may have reminders; a reminder always belongs to a task. There is no standalone reminders *page* or *tool* — reminders are managed as a facet of the task UI/tools — but they are their own table.

---

## 8. The Chat & Tool-Use Engine

### 8.1 Turn Flow

1. User sends a message.
2. The API route loads context: the Sentinel package (or, in the MVP, inline-assembled memory context) + the user's enabled tools from `tool_permissions`.
3. Claude receives the message + **only enabled tools** (disabled tools are never passed to the model).
4. Claude responds — plain text streamed to the user, or a tool call → execute → feed result back → continue the loop.
5. The full exchange is saved to `conversation_messages` (including `tool_calls` jsonb).
6. The Sentinel fires asynchronously on both the user message and the assistant response.

### 8.2 Tool Permission Enforcement

The engine filters the tool registry against the user's `tool_permissions` before every Claude call. Claude cannot call a tool it was never told about. This is both a safety mechanism and a productization lever (paid tiers can unlock more tools). Tools are opt-in per user with a registered identity.

### 8.3 Tool Registry (By Phase)

The registry lives in `apps/web/src/lib/chat/tools/registry.ts`; each tool has a JSON-Schema input and a handler in `tools/handlers/`.

**Foundation (built):**
| Tool | Purpose |
|------|---------|
| `create_task` | Create a task (title, description, priority, due_at) + optional inline reminders |
| `update_task` | Update task fields (title, description, priority, status, due_at) |
| `list_tasks` | Query tasks (with their reminders) by status, priority, limit |
| `add_reminder` | Add a reminder to a task (`remind_at`, recurrence) |
| `remove_reminder` | Remove a specific reminder from a task |
| `snooze_reminder` | Push a reminder back by N minutes |
| `delete_task` | Delete a task and all its reminders |

(As-built: reminders are separate `task_reminders` rows with dedicated tools — §7.4. An earlier draft of this list said `snooze_task`; corrected 2026-06-24 to match the code.)

**Memory phase:**
| Tool | Purpose |
|------|---------|
| `save_memory` | Store a durable fact (`{content, entity_name?}`) |
| `recall_memories` | Semantic search over memories (`{query, limit}`) |
| `upsert_entity` | Create/update an entity profile (`{name, entity_type, description}`) |
| `update_user_context` | Upsert structured context (writing style, relationships, preferences) |
| `summarize_conversation` | Write a session summary |

**Goals phase:**
| Tool | Purpose |
|------|---------|
| `create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project`, `generate_daily_briefing` | Goal hierarchy management + on-demand briefing |

**Comms phase:**
| Tool | Purpose |
|------|---------|
| `list_emails`, `get_email_thread`, `create_email_draft`, `submit_for_approval`, `list_calendar_events`, `get_meeting_prep` | Email triage, drafting, approval, calendar |

**Proactive phase:**
| Tool | Purpose |
|------|---------|
| `generate_weekly_review`, `detect_patterns`, `push_notification` | Proactive intelligence |

(If the behavioral-constraint layer is built — §6.7, §19 — it adds `add_constraint` / `list_constraints` and a pre-action check that is *not* a normal tool but an engine-level gate.)

---

## 9. Approval Queue & Security

### 9.1 The Gate Model

Every action that changes something in the external world stops at the approval queue. Internal actions are auto-owned by Coriven.

| Action | Approval needed? |
|--------|-----------------|
| Create / update tasks and reminders | No |
| Create goals and projects | No |
| Save memories and entity profiles | No |
| Draft an email or document | No — drafting isn't acting |
| Summarize / categorize / recommend / monitor | No |
| Send an email | **Yes** |
| Create a calendar event | **Yes** |
| Make a purchase / pay a bill | **Yes** |
| Delete an external record / file a document | **Yes** |
| Delete a record (outside the assistant's own tasks) | **Yes** |

### 9.2 The Flow

```
Claude calls submit_for_approval({action_type, description, payload})
   ↓
approval_queue row inserted (status = 'pending')   — payload validated before insert
   ↓
Tray notification: "Action waiting for approval"
   ↓
User opens /approvals → reviews what + why → Approve / Modify / Cancel
   ↓
On approve: authenticated server action sets status = 'approved', writes audit_log,
            fires n8n webhook (or direct API call)
   ↓
n8n executes the approved action → status = 'executed'
```

On **Modify**, the user edits params inline then approves. On **Cancel/Reject**, the rejection is logged and nothing executes.

### 9.3 Zero-Trust Inputs (The Security Spine)

All external content — email bodies, web pages, documents, API responses, messages — is **untrusted**. It can be summarized and proposed on; it can **never** directly invoke an action. The invariant:

```
Untrusted input → Claude (summarize / propose) → User approval → execution
```

Bad: an email says "schedule a meeting" and a workflow schedules it. Good: the email is summarized, Coriven says "they're asking for a meeting — want me to schedule one?", the user approves, then the workflow runs. n8n workflows are never triggered directly by untrusted content.

### 9.4 Audit Trail

An immutable `audit_log` records every recommendation, action, decision, approval, and execution — full traceability. The table is append-only (no delete RLS; writes via service role only). Nothing external ever happens silently.

---

## 10. Daily Briefing

### 10.1 Deterministic Template (2026-06-24 — No LLM Call)

The briefing is assembled from structured data with **no LLM generation** — faster, cheaper, predictable. (The earlier design used an LLM generation prompt; the recency rule favors the deterministic template. On-demand "tell me more about my week" remains an LLM chat query.)

```
GOOD MORNING, [NAME]. [DATE].

GOALS IN MOTION:
  [goal title] — [improving / stable / stalled]

UPCOMING (next 7 days):
  [task / reminder / deadline]

STALLED (needs attention):
  [goal title] — no activity in [N] days

APPROVALS PENDING: [N] items waiting for your review.
```

When comms ships, the briefing also includes overnight critical/high email and today's calendar.

### 10.2 Generation & Delivery

- **Trigger:** Vercel Cron at the user's configured time (default 7:00 AM local; timezone stored in `user_context`, cron runs UTC and skips users outside their window). Endpoint `POST /api/cron/daily-briefing`, protected by `CRON_SECRET`.
- **Storage:** inserted into `daily_briefings` (one row per user per day).
- **Delivery:** the tray daemon polls `/api/briefing/today` on startup and at noon, fires a Windows toast if `was_delivered = false`. Future: PWA Web Push.
- **Momentum integration:** improving goals get a positive indicator; stalled goals surface unprompted — this is where Coriven earns its keep.

---

## 11. Communications Intelligence

### 11.1 Email Triage

```
Gmail API (poll every 15 min via Vercel Cron)
  ↓ fetch new message IDs + headers (no body)
  ↓ Claude triage batch (Haiku): classify each
      urgency: critical | high | normal | low
      has_action_item: bool + action_item_summary
      one-line summary
  ↓ store to email_metadata (NO body stored — privacy + token cost)
  ↓ /email page: inbox view with AI categorization
```

Full email bodies are fetched from Gmail **on demand only** (when the user opens an email or Claude calls `get_email_thread`). Categories follow the PRD: Important, Action Required, Informational, Promotional, Spam.

### 11.2 Draft → Approval → Send

The canonical example from the PRD and vision: *"Reply to Sarah declining tomorrow's meeting."* Claude drafts the email and calls `submit_for_approval` → it lands in `approval_queue` → the tray notifies → the user reviews at `/approvals` and approves → n8n (or a direct Gmail call) sends → status `executed`. Drafting is free; sending requires approval (§9).

### 11.3 Calendar Intelligence

Read calendar data into `calendar_events` (hourly sync cron). Track meetings, appointments, family events, deadlines; detect conflicts; suggest scheduling. Writes (creating events) go through the approval queue.

### 11.4 Meeting Preparation

15 minutes before an event, a cron generates a prep brief from related emails + tasks + memories + entity profiles for the attendees, delivered as a tray notification. Gathers: relevant emails, calendar history, prior notes, project status; produces a brief + action items + follow-up tasks.

### 11.5 Follow-Up Detection

Nightly cron: find threads where the user sent the last message > 3 days ago with no reply. Surface as a follow-up candidate (in `/email` and, later, `detected_patterns`).

### 11.6 Integration & Token Security

OAuth tokens for Gmail/Calendar are stored in `integrations`, **encrypted with AES-256-GCM** (`DATA_ENCRYPTION_KEY`), decrypted server-side only, never sent to the client. Polling (not push webhooks) — 15-minute cadence is acceptable for a personal assistant and avoids the pub/sub infrastructure.

---

## 12. Proactive Intelligence

The shift from *"what task should I do next?"* to *"what is blocking this goal?"* — the assistant initiates, not just responds.

### 12.1 Pattern Detection

Nightly cron analyzes task-completion history to identify habits (gym frequency, review consistency, recurring blockers) and stores them in `detected_patterns`. A newly detected pattern fires a subtle informational tray notification.

### 12.2 Stale-Goal Nudges

A goal with no linked task activity for 14 days (§7.3) fires a tray notification: *"Your [goal] goal hasn't had activity in N days."* Tied to the goal-health model — the system won't let you silently forget what you said mattered.

### 12.3 Weekly Review

Friday 5pm cron generates a structured week-in-review (wins, blockers, next-week focus) from task + goal history, stored in `daily_briefings` (type `weekly`), delivered via tray.

### 12.4 Demand Detection (Future)

The research-validated proactive-surfacing approach: a module that ingests context signals and classifies the moment as **silent / fast-intervention / full-assistance**, using the user profile to infer latent needs, with a tunable helpfulness-vs-intrusiveness dial (λ). This is the mature form of proactivity — deferred until the profile/Sentinel layer has enough data. The cold-start problem (no behavioral data in week one) is a known open problem.

### 12.5 The Long-Horizon Vision (Noted, Not Built)

The accumulated entity graph + behavioral history is the substrate for decision modeling — inferring the factors that, when they align, cause a person to make a class of decision. Research found **zero** confirmed prior work on this under any framing (IRL, preference learning, causal inference have not been applied to long-horizon personal decision modeling) — genuinely uncharted territory. Not a near-term feature; requires months of data. Every current design choice either enables or forecloses it, so it stays in view. See §18.6.

---

## 13. The Tray App (Tauri — Windows + Mac)

### 13.1 Purpose

A lightweight, always-on local app that delivers reminders, daily briefings, and approval alerts **without requiring a browser open**. It is how Coriven is proactive on the desktop. No primary window — a native tray icon with a menu; alerts are native OS notifications.

### 13.2 Decision: Tauri Now, Thin Shell (2026-06-24)

The prior Node.js daemon (`apps/tray`, systray2 + node-notifier, ~400 lines) is being **replaced by Tauri**, not extended. Rationale: a Tauri port rewrites ~100% of the Node.js code, so building further tray features (briefing, approvals, nudges) in Node.js and then porting means building them twice. Tauri delivers Windows + Mac from one codebase immediately.

**Design principle — the tray is a thin shell; all logic lives in the backend API:**

- The tray only: authenticates, polls API endpoints, renders native notifications, and calls endpoints on user action.
- It contains **no business logic** — no direct database access, no recurrence math, no "what's due" rules. (The prior daemon violated this by querying `task_reminders` directly via Supabase and duplicating `getNextOccurrence`; the Tauri app must not.)
- Endpoints it consumes: `/api/tasks/due`, `/api/tasks/[id]/snooze` (both already built), `/api/briefing/today`, and later `/api/approvals/pending`.
- Consequence: web, tray, and future mobile share the same backend logic. Nothing tray-related is built twice — the shell is cheap and disposable by design.

### 13.3 Architecture

- **Shell:** Tauri (Rust core + system webview). One codebase → Windows `.exe` + Mac `.app`, built and signed in CI.
- **Tray + menu:** Tauri's native tray API — Open App / Snooze All / Quit. Cross-platform.
- **Notifications:** Tauri notification plugin (native Windows toast / Mac Notification Center) with action buttons: Snooze 15m / Snooze 1h / Dismiss.
- **Auth:** reuse the Supabase session pattern (sign-in + refresh token persisted to disk via Tauri's secure storage). At productization, move to a PKCE OAuth flow (localhost callback) rather than storing credentials.
- **Autostart:** Tauri autostart plugin — replaces the Windows-registry code; cross-platform.
- **Poll/fire loop:** poll `/api/tasks/due` ~every 5 min; fire native notifications for due items; offline → fire from the last cached payload.
- **Briefing / approvals:** poll `/api/briefing/today` (startup + noon) and `/api/approvals/pending` (comms phase); notify when present.

### 13.4 Signing & Distribution (The Cost of Going Now)

Accepted with this decision — one-time setup paid now rather than at productization: a Rust toolchain in the build; **Apple Developer Program ($99/yr) + notarization** for the Mac `.app`; a **Windows code-signing certificate** to avoid SmartScreen warnings; a CI pipeline producing both artifacts.

### 13.5 Mobile

On mobile the same delivery layer becomes **Web Push via the PWA** — identical backend, different delivery surface. There is no native tray concept on mobile.

---

## 14. Full Data Model

All tables: `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, with RLS `USING (user_id = auth.uid())`. SQL-first migrations in `supabase/migrations/`. Types auto-generated. This consolidates the data model across all docs, applying the recency rule (reminders merged into tasks; entity additions from 2026-06-24).

### 14.1 Foundation (Built)

```sql
profiles (
  id          uuid PK → auth.users.id,
  email       text NOT NULL,
  name        text,
  subscription_tier text DEFAULT 'free',   -- 'free' | 'core' | 'pro' (monetization)
  timezone    text,                         -- for briefing cron windowing
  created_at  timestamptz DEFAULT now()
)

tasks (
  id                uuid PK DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL → auth.users.id,
  title             text NOT NULL,
  description       text,
  status            task_status   DEFAULT 'pending',  -- pending|in_progress|done|cancelled
  priority          task_priority DEFAULT 'medium',   -- low|medium|high|urgent
  due_at            timestamptz,
  completed_at      timestamptz,
  -- goal hierarchy links (added in goals phase, nullable):
  project_id        uuid → projects.id,
  goal_id           uuid → goals.id,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
)

-- Reminders are a SEPARATE table (as-built; the "merge into tasks" plan was not executed — §7.4):
task_reminders (
  id                uuid PK DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL → auth.users.id,
  task_id           uuid NOT NULL → tasks.id ON DELETE CASCADE,
  remind_at         timestamptz NOT NULL,
  snoozed_until     timestamptz,
  recurrence_type   recurrence_type NOT NULL DEFAULT 'none', -- none|daily|weekdays|weekly|monthly|yearly
  recurrence_end_at timestamptz,
  last_fired_at     timestamptz,
  created_at        timestamptz DEFAULT now()
)
-- INDEX ON task_reminders(user_id, remind_at) WHERE remind_at IS NOT NULL;

tool_permissions (
  id          uuid PK,
  user_id     uuid NOT NULL → auth.users.id,
  tool_name   text NOT NULL,
  enabled     boolean DEFAULT true,
  granted_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, tool_name)
)

conversation_messages (
  id          uuid PK,
  user_id     uuid NOT NULL → auth.users.id,
  role        message_role NOT NULL,   -- user|assistant|tool
  content     text NOT NULL,
  tool_calls  jsonb,
  created_at  timestamptz DEFAULT now()
)
```

### 14.2 Memory Phase

```sql
-- CREATE EXTENSION IF NOT EXISTS vector;

entity_profiles (
  id             uuid PK DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL → auth.users.id,
  name           text NOT NULL,
  entity_type    text NOT NULL CHECK (entity_type IN ('person','place','project','thing','resource')),
  description    text NOT NULL,
  aliases        text[]  DEFAULT '{}',          -- 2026-06-24
  last_mentioned timestamptz,                    -- 2026-06-24 temporal tracking
  mention_count  integer DEFAULT 0,              -- 2026-06-24
  recency_weight float   DEFAULT 1.0,            -- 2026-06-24 (decays 10%/week)
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
)

memories (
  id             uuid PK DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL → auth.users.id,
  content        text NOT NULL,
  entity_name    text,
  confidence     float DEFAULT 1.0,
  embedding      vector(1536),
  superseded_by  uuid → memories.id,             -- supersession, not deletion
  tags           text[] DEFAULT '{}',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  access_count   integer DEFAULT 0
)
-- INDEX ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
-- match_memories(query_embedding, match_user_id, match_count) RPC; excludes superseded.

user_context (
  id          uuid PK,
  user_id     uuid NOT NULL → auth.users.id,
  key         text NOT NULL,    -- communication_style | key_relationships | writing_samples | timezone | ...
  value       jsonb NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, key)
)

conversation_summaries (
  id               uuid PK,
  user_id          uuid NOT NULL → auth.users.id,
  period_start     timestamptz NOT NULL,
  period_end       timestamptz NOT NULL,
  summary          text NOT NULL,
  key_decisions    text[] DEFAULT '{}',
  topics_discussed text[] DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
)

-- Sentinel phase only (Upstash is primary; this is the durable fallback):
sentinel_context (
  user_id    uuid PK → auth.users.id,
  context    text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
)
```

### 14.3 Goals Phase

```sql
life_areas (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  name text NOT NULL, icon text, color text, sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
)

goals (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  life_area_id uuid NOT NULL → life_areas.id,
  title text NOT NULL,
  why_it_matters  text,
  success_metrics text[] DEFAULT '{}',
  status     goal_status     DEFAULT 'active',    -- active|achieved|paused|abandoned
  confidence goal_confidence DEFAULT 'medium',    -- high|medium|low
  momentum   goal_momentum   DEFAULT 'stable',    -- improving|stable|declining
  target_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

projects (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  goal_id uuid → goals.id,                         -- nullable
  title text NOT NULL, description text,
  status project_status DEFAULT 'active',          -- active|completed|archived
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

daily_briefings (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  briefing_date date NOT NULL,
  content text NOT NULL,
  briefing_type text DEFAULT 'daily',              -- daily | weekly
  generated_at timestamptz DEFAULT now(),
  was_delivered boolean DEFAULT false,
  delivery_channel text DEFAULT 'tray',            -- tray | email | push
  UNIQUE (user_id, briefing_date, briefing_type)
)
```

### 14.4 Comms Phase

```sql
integrations (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  provider integration_provider NOT NULL,          -- gmail|outlook|google_calendar|outlook_calendar
  access_token_encrypted  text NOT NULL,           -- AES-256-GCM
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] DEFAULT '{}',
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
)

email_metadata (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  provider integration_provider NOT NULL,
  message_id text NOT NULL, thread_id text,
  subject text, from_address text, received_at timestamptz,
  labels text[] DEFAULT '{}', is_read boolean DEFAULT false,
  has_action_item boolean DEFAULT false, action_item_summary text,
  urgency email_urgency DEFAULT 'normal',          -- critical|high|normal|low
  summary text,                                    -- AI one-liner; NO body stored
  UNIQUE (user_id, provider, message_id)
)

calendar_events (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  provider integration_provider NOT NULL,
  event_id text NOT NULL, title text, description text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  attendees jsonb DEFAULT '[]', location text,
  is_prep_generated boolean DEFAULT false,
  UNIQUE (user_id, provider, event_id)
)

approval_queue (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  action_type text NOT NULL,                       -- send_email | create_event | delete_record | purchase | ...
  description text NOT NULL,
  payload jsonb NOT NULL,                          -- validated before insert
  status approval_status DEFAULT 'pending',        -- pending|approved|rejected|executed
  created_at timestamptz DEFAULT now(),
  decided_at timestamptz, executed_at timestamptz
)

audit_log (                                        -- append-only; service-role writes only
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  action text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
)
```

### 14.5 Proactive Phase

```sql
detected_patterns (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  pattern_type text NOT NULL,                      -- gym_days | weekly_review_time | stale_goal | follow_up_needed
  description text NOT NULL,
  last_detected_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
)
```

### 14.6 Behavioral-Constraint Layer (Proposed — §6.7, §19)

```sql
-- ONLY if the constraint layer is approved for build (open decision §19):
behavioral_constraints (
  id uuid PK, user_id uuid NOT NULL → auth.users.id,
  rule text NOT NULL,                              -- "Never modify MealPrepForge website code"
  rationale text,                                  -- the WHY — richly encoded, harder to rationalize around
  scope text,                                      -- entity/tool/domain this applies to
  is_locked boolean DEFAULT true,                  -- user-authored & locked
  created_at timestamptz DEFAULT now()
)
```

---

## 15. Platform Strategy

Ship web-first; expand to native surfaces when demand justifies the cost. One codebase serves everyone at launch.

| Surface | Technology | When |
|---------|-----------|------|
| **Web (PWA)** | Single responsive Next.js codebase; service worker; Web Push; add-to-home-screen; offline context cache | Now / foundation |
| **Windows + Mac tray** | Tauri (single codebase → `.exe` + `.app`); thin shell over the API | Now — replaces the prior Node.js daemon (§13) |
| **iOS + Android** | Capacitor wrapping the web app (no separate React Native rebuild) | Post-beta, only if PWA usage shows demand |

Principle: the backend API is identical across all surfaces; only the delivery shell changes. Web Push covers Android Chrome and iOS Safari 16.4+. Native is triggered by data, not assumption.

---

## 16. Monetization & Business

### 16.1 Legal & Payment Structure

Coriven operates under **MealPrepForge LLC as a DBA** (fictitious-name registration, Missouri, ~$7) — no separate LLC, EIN, or bank account initially. Payments run through the **existing MealPrepForge Stripe account** as a second product line. If Coriven generates meaningful revenue, form a separate LLC to cleanly separate liability and enable a future sale/investment. (Decided 2026-06-23.)

### 16.2 Thesis — Memory as the Conversion Mechanism

Freemium where **the entity cap is the paywall.** The core promise is "it remembers you," so the conversion trigger is the moment it can't remember any more — the user feels the value most acutely exactly when they hit the limit.

### 16.3 Tiers

| | Free | Core | Pro |
|---|---|---|---|
| **Price** | $0 | $12/mo | $22/mo |
| **Entities** | 10 | Unlimited | Unlimited |
| **Memory window** | 24 hours | 7 days | 30 days |
| **Device sync** | Single device | Cross-device | Cross-device |
| **Reminders** | 1/day | 3/day | Unlimited |
| **Tray daemon** | Basic briefing only | Full daemon | Full daemon |

Annual billing: 2 months free (Core $120/yr, Pro $220/yr). Enforcement in middleware: check `subscription_tier` before tool execution (entity/reminder creation) and page access.

### 16.4 Conversion Triggers

1. **Entity cap hit** (primary) — at entity #10: "Coriven can't remember anyone else." The memory cliff, felt immediately.
2. **Cross-device sync** — free users lose context switching devices; Core removes the friction.
3. **Reminder frequency cap** — free users hit 1/day and want more.
4. **Memory window** — after 7d (Core) / 30d (Pro), older memories stop surfacing; weeks-in users feel this most.

### 16.5 Early-Adopter Strategy (Beta)

- **Lifetime deal:** $199 one-time, first 200 signups only.
- **Free trial:** 7 days of Core. **No credit card at signup** — the trial triggers contextually at the entity cap or reminder cap, not cold at signup.

---

## 17. Phased Roadmap

Phase numbering follows the **2026-06-20 unified vision** (the later, more complete scheme), extended by the 2026-06-24 additions. The original 8-phase plan (scaffolding → supabase → auth → tasks → reminders → chat → tray → deploy) is entirely contained within **Phase 1** below and is largely built.

### 17.1 Phase 1 — Foundation (Largely Built)

**Goal:** Running, deployed, used daily.
**Built:** monorepo, Supabase schema + RLS, auth, task CRUD + UI, chat engine with tool use, tool-permission toggles, reminders-merged-into-tasks, Windows tray daemon.
**Remaining:** confirm `/api/tasks/due` correctness end-to-end; Vercel production deploy + env vars; **replace the Node.js tray daemon with a Tauri (Windows + Mac) thin-shell app — §13** (decided 2026-06-24); remove `apps/tray` (Node.js) once Tauri reaches parity.
**Acceptance:** create a task with a reminder 2 min out → within 5 min a Windows toast fires with the browser closed → Snooze/Dismiss work.

### 17.2 Phase 2 — Persistent Memory

**Goal:** Coriven remembers across conversations. Solves the sister and Coke/Pepsi problems.
**Build:** enable pgvector; `entity_profiles` (with aliases + temporal fields), `memories` (with `superseded_by`), `user_context`, `conversation_summaries`; embedding service; retrieval; context injection into the chat engine; `save_memory` / `recall_memories` / `upsert_entity` / `update_user_context` / `summarize_conversation` tools; `/memory` management page (entities + memories tabs, view/edit/delete).
**Then (2b — Sentinel):** Upstash cache + `sentinel_context` fallback; Haiku extraction; async Sentinel firing on user AND assistant messages; chat reads the pre-built package (the integration contract — verify the cache read happens).
**Acceptance:** say "my sister Sarah lives in Denver" in one session → in a new session, "I'm visiting my sister" → Coriven mentions Denver and offers flights. "Sarah moved to Austin" supersedes Denver. `/memory` shows and can correct everything. Restart resilience (Supabase fallback warms Upstash).

### 17.3 Phase 3 — Goal-Driven Organization

**Goal:** Life-OS dashboard replaces task-list mentality.
**Build:** `life_areas`, `goals`, `projects`, `daily_briefings`; `project_id`/`goal_id` on tasks; `/goals` (life areas as columns, goal cards with momentum), `/goals/[id]`, `/projects/[id]`; goal tools; momentum formula (§7.3); **deterministic** daily-briefing generation; Vercel cron at 7am (timezone-aware); tray briefing delivery.
**Acceptance:** create Health → "Lose 100 lbs" with why + metrics → link a gym task → `/goals` shows momentum → next morning a tray briefing mentions the goal and today's task.

### 17.4 Phase 4 — Communications Intelligence

**Goal:** Email triage saves real time; approval gates prove trust.
**Build:** `integrations` (`nango_connection_id` + provider per user), `email_metadata`, `calendar_events`, `approval_queue`, `audit_log`; Gmail + Google Calendar + Microsoft Graph/Outlook OAuth via self-hosted Nango; 15-min email poll + Haiku triage; `/email`; draft → approval → send; `/approvals`; meeting prep; follow-up detection.
**Integration architecture (ADR-013, revised 2026-07-04 after research validation):** **Self-hosted Nango** owns all OAuth flows and token storage — multi-tenant, no raw tokens in Coriven's DB, keeps the Gmail data path inside our CASA assessment boundary. **Direct provider API calls** (Gmail, Outlook, Google Calendar) for read path (poll/fetch) and write path (approved actions). **Long-tail connectors deferred to a dedicated post-validation epic** — Zapier Embed ruled out as primary (user-pays economics); future candidates Composio/Pipedream Connect behind an MCP-shaped swappable interface; banking via Plaid/Teller regardless. Approval UI must show raw action payloads (never only an LLM summary); egress allowlist on model output; `gmail.readonly` may launch before `gmail.send`. Google CASA (~$1–5K/yr) exempt under 100 Gmail users — budget at productization.
**Acceptance:** connect Gmail via Nango → emails classified within 15 min → "draft a reply to Sarah declining" → appears in approvals (raw payload visible) → approve → sent. Meeting-prep toast 15 min before an event. Untrusted email content never triggers an action (explicit test).

### 17.5 Phase 5 — Proactive Intelligence

**Goal:** The assistant initiates.
**Build:** `detected_patterns`; nightly pattern detection; stale-goal nudges; Friday weekly review; cross-context queries ("what's been happening with my gym project?" pulls email + tasks + memory); proactive tools.
**Acceptance:** stop completing a goal's tasks for 7 days → get a nudge. Friday 5pm → accurate weekly review.

### 17.6 Phase 6 — Productization

**Goal:** Multi-user, subscription billing, self-serve onboarding.
**Build:** Stripe subscriptions (via MealPrepForge DBA) + `subscription_tier`; tier enforcement middleware; entity-cap upgrade prompt; pricing page; $199 lifetime + 7-day no-CC trial flows; 4-step onboarding wizard; PWA (service worker, Web Push); (the Tauri Windows+Mac tray already shipped in Phase 1 — §13); (Capacitor mobile if demand).
**Acceptance:** new user completes onboarding with a first goal + task; free user sees the upgrade prompt at entity #10; mobile Web Push reminder fires.

### 17.7 Cross-Cutting — Behavioral-Constraint Layer (Conditional)

If approved (§19), slots in after Phase 2 (it depends on the memory layer existing): `behavioral_constraints` table, user-authored constraint registry UI, engine-level pre-action check, optional post-generation violation detection. Could be a headline differentiator or a v2 feature — decision pending.

---

## 18. Candidate & Deferred Features

Captured so they aren't lost; each has a status. Nothing here is in the committed roadmap above without an explicit decision.

### 18.1 Medication Tracking
Prominent in the original PRD (track meds/schedules, Taken/Skip/Snooze confirmation, compliance reports, missed-dose alerts in the briefing). **Deferred** in the unified vision pending whether task reminders already cover the need. **Open decision (§19)** — has high personal value if the user wants it; would be a dedicated `medications` table + time-of-day reminders + compliance reporting.

### 18.2 Research Assistant
Claude + a web-search tool (Brave/Tavily) for in-chat research with citations and tracked prior research. Near-term add-on candidate (no new tables; one `web_search` tool). From the PRD's Research Assistant capability.

### 18.3 Voice Interface
Web Speech API for input; Claude TTS or ElevenLabs for spoken briefings. Mobile-primary; deferred until the briefing system is mature.

### 18.4 Local LLM Fallback
Ollama for privacy-sensitive queries (medical, financial), with a routing layer choosing local vs. cloud by content classification. From the original tech-stack discussion's multi-provider model routing. Deferred.

### 18.5 Bi-Temporal / Graph Memory
The research-validated end-state for memory evolution (Graphiti-style four-timestamp edges; full relationship traversal). Deferred until usage data justifies the complexity. The simplified `superseded_by` handles supersession in the interim. (§6.5.c)

### 18.6 Decision Modeling (The Big Vision)
Inferring *why* the user makes decisions from accumulated behavioral data — genuinely uncharted (no confirmed prior art). Requires months of data. Not a feature; a direction the architecture must not foreclose. (§12.5)

### 18.7 MCP Server Exposure
Expose Coriven's tools (tasks, goals, memory, approvals) via Model Context Protocol so Claude Code and other MCP clients can use them. The tool registry's JSON Schemas are already close to MCP-compatible. Deferred — no user value until productization.

### 18.8 Team / Shared Contexts
Multi-user orgs with `org_id` on shared records and org-level RLS. Phase 6+. Supabase Auth supports it natively.

### 18.9 Custom Recurrence Intervals
"Every 3 days," "every 2 weeks." The current set is daily/weekdays/weekly/monthly/yearly. Deferred.

### 18.10 Advisor Model Pattern in Chat Engine
The Anthropic API exposes an `advisor_20260301` server-side tool (beta) that pairs a fast/cheap **executor** model with a higher-capability **advisor** model consulted mid-generation. For Coriven this could mean Haiku or Sonnet as the executor for routine chat, calling Opus 4.8 (or Fable 5 when valid in the pairing table) as an advisor on complex reasoning tasks — better quality at lower average cost than running Opus for everything.

**How to evaluate:** wire the advisor tool into `apps/web/src/lib/chat/engine.ts` behind a feature flag; compare response quality and latency on a set of Sentinel-heavy or goal-hierarchy queries. Key constraints: advisor model must be at least as capable as the executor; pass the full `response.content` including `advisor_tool_result` blocks back in subsequent turns; beta header `anthropic-beta: advisor-tool-2026-03-01` required. Deferred until the chat engine is stable post-Phase 3.

---

## 19. Open Decisions for the Build Plan

These are genuine product decisions that the consolidation surfaced. They are **not** resolved here — resolve them before/while writing the implementation plan.

1. **Behavioral-constraint layer — build it, and when?** The research says it's unsolved and a real differentiator, but the "what actually works" approaches are theoretical/unvalidated. Options: (a) headline feature right after Phase 2; (b) lightweight v1 (user-authored registry + pre-action check) now, sophistication later; (c) defer entirely. *Recommendation: (b) — a user-authored constraint registry + a simple pre-action check is low-cost and directly addresses the MealPrepForge trust problem.*

2. **Medication tracking — in or out?** High personal value, but adds a domain. Decide whether task reminders suffice or it warrants a dedicated module (§18.1).

3. **Sentinel timing — with the memory MVP or after?** The MVP (synchronous context assembly) ships value fastest; the Sentinel is the differentiator but adds Upstash + async complexity. Decide whether Phase 2 ships the MVP first and the Sentinel as 2b, or goes straight to the Sentinel.

4. ~~**n8n vs. direct API calls for Phase 4 launch.**~~ **Resolved (2026-07-02; revised 2026-07-04 after research validation, ADR-013):** **Self-hosted Nango** handles all OAuth flows and token storage (multi-tenant, no raw tokens in Coriven's DB). **Direct provider API calls** for deep integrations (Gmail, Outlook, Google Calendar) on both read and write paths. **Long-tail connectors deferred to a dedicated post-validation epic** — n8n ruled out (single-tenant), Zapier Embed ruled out as primary (each user needs their own paid Zapier plan); future candidates Composio / Pipedream Connect behind an MCP-shaped swappable interface, decided with real usage data on which apps users want.

5. **Pricing validation.** Tiers ($12 / $22, 10-entity free cap) are reasoned but unvalidated. Decide whether to launch with them or test alternatives. The entity cap as the primary paywall is the load-bearing assumption.

   **Market data (2026-07-04 research pass):** The $12/$22 tiers were reasoned before the full integration vision and are likely underpriced. Direct comps: **Martin** (closest analog — AI assistant for email/calendar/SMS/calls) charges $21/mo standard, $30/mo Pro, with Pro gating email pre-drafting and long-term memory — features Coriven treats as core. **Lindy** runs $49.99–$199.99/mo (prosumer, credit-based). **Motion** $19–29/mo. General-AI anchor (ChatGPT Plus / Claude Pro) is $20/mo; the typical professional assistant stack runs $40–70/mo.

   **Cost model per daily-active user:** LLM is the dominant COGS (~$3–10/mo: Sonnet chat + Haiku triage); integrations are nearly free to bundle (Composio-style long-tail ~$0.30–1/user, Nango self-hosted + provider APIs pennies, CASA ~$0.20–0.80/user amortized at 500 users). Total ~$4–12/user/mo. At $22 margins are thin for heavy users; at $30–39, comfortable.

   **Candidate structure to test at productization:** ~$19–22 base (email/calendar assistant, in line with Martin standard, above the ChatGPT anchor because Coriven *acts*); ~$35–39 "Connected Life" tier shipping with the long-tail connector epic, bundled integrations included — bundling at ~$1/user is strictly better UX and economics than any user-pays model (Zapier ruled out at any Coriven price point for this structural reason, not its absolute cost; see ADR-013 Layer 3).

6. **Memory window as a paid limit — technically how?** "24h / 7d / 30d memory window" implies time-bounding retrieval by tier. Confirm this is enforced at retrieval (filter by age) and that it degrades gracefully rather than feeling broken.

7. **Embeddings vendor.** Plan uses OpenAI `text-embedding-3-small` (cheap, proven). Confirm we're comfortable adding OpenAI as a dependency alongside Anthropic, or whether to use an alternative embedding source.

---

## 20. Environment & Configuration Reference

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only

# Anthropic (chat + extraction)
ANTHROPIC_API_KEY=

# OpenAI (embeddings only — memory phase)
OPENAI_API_KEY=

# Upstash Redis (Sentinel phase)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# App URL (needed for the Sentinel fetch)
NEXT_PUBLIC_APP_URL=

# Cron security (briefing, polls)
CRON_SECRET=

# Data encryption (OAuth tokens — comms phase)
DATA_ENCRYPTION_KEY=              # 32-byte hex, AES-256-GCM

# n8n (comms phase)
N8N_WEBHOOK_URL=
N8N_WEBHOOK_SECRET=

# Stripe (productization)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Tray daemon (apps/tray/.env)
API_BASE=                         # https://your-app.vercel.app
SUPABASE_URL=
```

Model IDs: chat `claude-sonnet-4-6`; extraction `claude-haiku-4-5-20251001`; embeddings `text-embedding-3-small` (1536 dims).

---

## 21. Source Provenance Appendix

Quick map of which source contributed what, for traceability when revisiting decisions:

- **Vision & narrative:** `Personal-Assistant-Vision.md` (Sentinel, day-in-the-life, the bigger vision); original `.docx` PRD (Life-OS framing, jobs-to-be-done, goal hierarchy, zero-trust, medication tracking).
- **Locked decisions:** `decisions.md` (Supabase, TypeScript, per-tool opt-in, hosting); `Technical Stack & n8n.docx` (n8n boundary, model routing).
- **Concrete architecture & data model:** `2026-06-19-personal-assistant-design.md`; `unified-vision.md` (the prior master — data model, tools, phases).
- **Build mechanics:** `2026-06-19-implementation-plan.md`; `merge-reminders-into-tasks.md`; `phase2-memory-sentinel.md` (the Sentinel implementation steps).
- **Memory design:** `memory-mvp.md` (the simple increment); the two research reports (what's validated, the constraint problem, entity/proactive/causal); `sentinel-context-architecture.md` (the novel architecture + prior-art analysis).
- **Recent additions:** `architecture-additions.md` (aliases, temporal tracking, RESOURCE type, momentum formula, monetization); 2026-06-23 session (Coriven naming, MealPrepForge DBA business structure).

**Applying recency (§0.4):** where these conflict, the later document governs. This blueprint is now the top of that stack — future changes update *this* document.

---

*End of blueprint. Next step: turn §17 + §19 into the step-by-step implementation plan, resolving the open decisions first.*

