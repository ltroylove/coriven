# Personal Assistant — Unified Vision & Implementation Guide

**Date:** 2026-06-20  
**Status:** Active reference  
**Supersedes:** `2026-06-19-personal-assistant-design.md`, `2026-06-19-implementation-plan.md`

This document is the single source of truth for what we are building, why, how the system is structured, and what each phase delivers. It is written for a developer who will implement each phase with no additional design sessions required.

---

## 1. Core Thesis

### What This Is

A personal Life OS — not a task manager, not a chatbot, not a notes app. The distinction matters for every product decision:

- A task manager is a list. This is a *reasoning engine over your life*.
- A chatbot answers questions. This proactively surfaces what you need to know *before* you ask.
- A notes app stores what you type. This *extracts meaning* from your interactions and remembers it structurally.

The organizing principle is **goal hierarchy**: everything in the system connects upward to a reason it exists.

```
Life Area  →  Goal  →  Project  →  Task  →  Reminder/Event
  Health        Lose       Gym           Go to       Tuesday
                100 lbs    Routine       gym           7am
```

This is different from every tier-1 competitor (Notion, Things, Todoist, Motion): none of them organize around *why*, only *what*. The goal hierarchy creates a feedback loop — the system can tell you whether your *actions* are actually serving your *intentions*.

### Philosophy: AI Does Not Own Truth

The assistant reads, interprets, suggests, and acts. It does not own canonical data:

- **Calendar owns appointments.** The assistant reads calendar, suggests scheduling, but the calendar system is the source of truth.
- **Email owns messages.** The assistant triages and drafts, but Gmail/Outlook is the record of truth.
- **Task Manager owns tasks.** The assistant creates and manages tasks, but the database is authoritative.

Consequence: AI output is always advisory or queued for approval. It never silently mutates external systems.

### Approval Gates

Every write action outside the assistant's own data goes through explicit user approval:

| Action type | Approval required? |
|-------------|-------------------|
| Send email | Yes |
| Schedule calendar event | Yes |
| Delete a record | Yes (unless within the assistant's own tasks) |
| Make a purchase | Yes |
| Summarize content | No |
| Draft content | No |
| Recommend actions | No |
| Monitor / detect patterns | No |
| Create/update tasks | No (assistant owns tasks) |

The `approval_queue` table holds pending actions. n8n (Phase 4+) only fires after `status = 'approved'`. An immutable `audit_log` records every approval and execution.

---

## 2. Architecture

### System Diagram

```
Your Machine (Windows)                  Cloud (Vercel + Supabase)
┌─────────────────────────┐            ┌──────────────────────────────────────┐
│                         │            │                                      │
│  Tray Daemon (Node.js)  │            │  Next.js App (App Router)            │
│  - Polls every 5 min    │──HTTPS────▶│  - Web UI (React)                    │
│  - Fires toast notifs   │            │  - API Routes (/api/*)               │
│  - Snooze/Dismiss       │            │  - Server Actions                    │
│                         │            │  - Chat Engine (Claude + tools)      │
│  Browser                │──HTTPS────▶│                                      │
│  (same Vercel URL)      │            │  Supabase                            │
│                         │            │  - Postgres (all tables)             │
└─────────────────────────┘            │  - Auth (email/password + sessions)  │
                                       │  - RLS (user_id isolation)           │
                                       │  - pgvector (memory embeddings)      │
                                       │                                      │
                                       │  Vercel Cron Jobs                    │
                                       │  - Daily briefing (7am)              │
                                       │  - Email poll (every 15 min, Ph4)    │
                                       │  - Pattern detection (nightly, Ph5)  │
                                       └──────────────────┬───────────────────┘
                                                          │
                                               Approved actions only
                                                          │
                                       ┌──────────────────▼───────────────────┐
                                       │  n8n (Phase 4+, self-hosted)         │
                                       │  Execution worker — never triggered  │
                                       │  directly by untrusted content       │
                                       │  - Send approved email               │
                                       │  - Write calendar event              │
                                       │  - Post webhook / Slack              │
                                       │  - Sync external APIs                │
                                       └──────────────────────────────────────┘
```

### n8n Security Rule

n8n workflows must **never** be triggered directly by untrusted content (email body, AI output, webhook payload). The invariant is:

```
Untrusted input → Claude (summarize/propose) → User approval → n8n executes
```

n8n only receives a webhook after `approval_queue.status` is set to `'approved'` by an authenticated user action. The webhook payload is a pre-validated action descriptor, not raw content.

### Monorepo Structure

```
apps/
  web/                   ← Next.js 15 (UI + API) → Vercel
    src/
      app/               ← App Router pages and layouts
        (app)/           ← Authenticated routes
          tasks/
          goals/         ← Phase 3
          email/         ← Phase 4
          memory/        ← Phase 2
          approvals/     ← Phase 4
        api/             ← API routes
        auth/            ← Sign in page
      actions/           ← Server Actions
      components/        ← Shared UI components
      lib/
        supabase/        ← 4 client variants (browser, server, middleware, admin)
        anthropic.ts     ← Model constants, client init
        chat/
          engine.ts      ← Core chat loop (Claude + tool use)
          tools/
            registry.ts  ← Tool definitions (grows each phase)
            handlers/    ← One file per tool
        memory/          ← Phase 2: embed, retrieve, inject
        jobs/            ← Phase 3+: briefing gen, pattern detection
      types/
        supabase.ts      ← Auto-generated from supabase gen types
  tray/                  ← Node.js daemon → runs locally on Windows
    src/
      index.ts           ← Entry point
      auth.ts            ← Supabase session load from disk
      poller.ts          ← Poll /api/tasks/due every 5 min
      notifier.ts        ← node-notifier Windows toast
      startup.ts         ← Windows registry key for auto-start
packages/
  types/                 ← Shared TypeScript types
    src/
      index.ts
      task.ts
      reminder.ts
      goal.ts            ← Phase 3
      memory.ts          ← Phase 2
      briefing.ts        ← Phase 3
supabase/
  migrations/            ← SQL-first, one file per migration
docs/
  planning/              ← Design docs
```

---

## 3. Full Data Model

All tables: `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`. RLS policy on every table: `USING (user_id = auth.uid())`.

### Already Built (Phase 1)

```sql
-- Extends Supabase auth.users
profiles (
  id           uuid  PK → auth.users.id,
  email        text  NOT NULL,
  name         text,
  created_at   timestamptz DEFAULT now()
)

tasks (
  id           uuid  PK DEFAULT gen_random_uuid(),
  user_id      uuid  NOT NULL → auth.users.id,
  title        text  NOT NULL,
  description  text,
  status       task_status DEFAULT 'todo',      -- enum: todo|in_progress|done|cancelled
  priority     task_priority DEFAULT 'medium',  -- enum: low|medium|high|urgent
  due_date     timestamptz,
  project_id   uuid → projects.id,              -- added Phase 3, nullable
  goal_id      uuid → goals.id,                 -- added Phase 3, nullable
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
)

task_reminders (
  id             uuid  PK DEFAULT gen_random_uuid(),
  user_id        uuid  NOT NULL → auth.users.id,
  task_id        uuid  NOT NULL → tasks.id ON DELETE CASCADE,
  remind_at      timestamptz NOT NULL,
  snoozed_until  timestamptz,
  is_dismissed   boolean DEFAULT false,
  created_at     timestamptz DEFAULT now()
)

tool_permissions (
  id          uuid  PK DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL → auth.users.id,
  tool_name   text  NOT NULL,
  is_enabled  boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, tool_name)
)

conversation_messages (
  id          uuid  PK DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL → auth.users.id,
  role        message_role NOT NULL,  -- enum: user|assistant|tool
  content     text  NOT NULL,
  tool_calls  jsonb,
  created_at  timestamptz DEFAULT now()
)
```

### Phase 2 — Memory Layer

```sql
-- Enable pgvector extension first:
-- CREATE EXTENSION IF NOT EXISTS vector;

memories (
  id               uuid    PK DEFAULT gen_random_uuid(),
  user_id          uuid    NOT NULL → auth.users.id,
  entity           text,                        -- e.g. "dog", "sister", "work schedule"
  content          text    NOT NULL,            -- e.g. "My dog's name is Biscuit"
  confidence       float   DEFAULT 1.0,         -- 0.0–1.0; degrades if contradicted
  embedding        vector(1536),                -- text-embedding-3-small dims
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  access_count     integer DEFAULT 0,
  tags             text[]  DEFAULT '{}'         -- e.g. ['family', 'pets']
)

-- Index for similarity search:
-- CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

user_context (
  id          uuid  PK DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL → auth.users.id,
  key         text  NOT NULL,                   -- e.g. "communication_style", "key_relationships", "writing_samples"
  value       jsonb NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, key)
)

conversation_summaries (
  id                uuid   PK DEFAULT gen_random_uuid(),
  user_id           uuid   NOT NULL → auth.users.id,
  period_start      timestamptz NOT NULL,
  period_end        timestamptz NOT NULL,
  summary           text   NOT NULL,
  key_decisions     text[] DEFAULT '{}',
  topics_discussed  text[] DEFAULT '{}',
  created_at        timestamptz DEFAULT now()
)
```

### Phase 3 — Goal Hierarchy

```sql
life_areas (
  id          uuid  PK DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL → auth.users.id,
  name        text  NOT NULL,       -- e.g. "Health", "Career", "Family"
  icon        text,                 -- emoji or icon identifier
  color       text,                 -- hex color for UI
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
)

goals (
  id               uuid  PK DEFAULT gen_random_uuid(),
  user_id          uuid  NOT NULL → auth.users.id,
  life_area_id     uuid  NOT NULL → life_areas.id,
  title            text  NOT NULL,
  why_it_matters   text,                              -- forced articulation of motivation
  success_metrics  text[] DEFAULT '{}',               -- measurable criteria
  status           goal_status DEFAULT 'active',      -- enum: active|achieved|paused|abandoned
  confidence       goal_confidence DEFAULT 'medium',  -- enum: high|medium|low
  momentum         goal_momentum DEFAULT 'stable',    -- enum: improving|stable|declining
  target_date      date,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
)

projects (
  id           uuid  PK DEFAULT gen_random_uuid(),
  user_id      uuid  NOT NULL → auth.users.id,
  goal_id      uuid  → goals.id,               -- nullable: projects don't need a goal
  title        text  NOT NULL,
  description  text,
  status       project_status DEFAULT 'active', -- enum: active|completed|archived
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
)

-- tasks gets two new nullable FK columns (Phase 3 migration):
-- ALTER TABLE tasks ADD COLUMN project_id uuid REFERENCES projects(id);
-- ALTER TABLE tasks ADD COLUMN goal_id uuid REFERENCES goals(id);

daily_briefings (
  id               uuid  PK DEFAULT gen_random_uuid(),
  user_id          uuid  NOT NULL → auth.users.id,
  briefing_date    date  NOT NULL,
  content          text  NOT NULL,          -- full markdown briefing text
  generated_at     timestamptz DEFAULT now(),
  was_delivered    boolean DEFAULT false,
  delivery_channel text DEFAULT 'tray',     -- 'tray' | 'email' | 'push'
  UNIQUE (user_id, briefing_date)
)
```

### Phase 4 — Communications Intelligence

```sql
integrations (
  id                     uuid  PK DEFAULT gen_random_uuid(),
  user_id                uuid  NOT NULL → auth.users.id,
  provider               integration_provider NOT NULL, -- enum: gmail|outlook|google_calendar|outlook_calendar
  access_token_encrypted text  NOT NULL,
  refresh_token_encrypted text,
  token_expires_at       timestamptz,
  scopes                 text[] DEFAULT '{}',
  last_synced_at         timestamptz,
  created_at             timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
)

email_metadata (
  id                   uuid  PK DEFAULT gen_random_uuid(),
  user_id              uuid  NOT NULL → auth.users.id,
  provider             integration_provider NOT NULL,
  message_id           text  NOT NULL,
  thread_id            text,
  subject              text,
  from_address         text,
  received_at          timestamptz,
  labels               text[] DEFAULT '{}',
  is_read              boolean DEFAULT false,
  has_action_item      boolean DEFAULT false,
  action_item_summary  text,
  urgency              email_urgency DEFAULT 'normal', -- enum: critical|high|normal|low
  summary              text,                           -- AI-generated one-liner
  UNIQUE (user_id, provider, message_id)
)

calendar_events (
  id                uuid  PK DEFAULT gen_random_uuid(),
  user_id           uuid  NOT NULL → auth.users.id,
  provider          integration_provider NOT NULL,
  event_id          text  NOT NULL,
  title             text,
  description       text,
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  attendees         jsonb DEFAULT '[]',       -- [{name, email}]
  location          text,
  is_prep_generated boolean DEFAULT false,    -- has meeting prep been generated?
  UNIQUE (user_id, provider, event_id)
)

approval_queue (
  id           uuid  PK DEFAULT gen_random_uuid(),
  user_id      uuid  NOT NULL → auth.users.id,
  action_type  text  NOT NULL,              -- e.g. 'send_email', 'create_event', 'delete_record'
  description  text  NOT NULL,             -- human-readable summary of the action
  payload      jsonb NOT NULL,             -- full action parameters (validated before insert)
  status       approval_status DEFAULT 'pending', -- enum: pending|approved|rejected|executed
  created_at   timestamptz DEFAULT now(),
  decided_at   timestamptz,
  executed_at  timestamptz
)

audit_log (
  id          uuid  PK DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL → auth.users.id,
  action      text  NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
)
-- audit_log has NO delete RLS — append-only via service role only
```

### Phase 5 — Proactive Intelligence

```sql
detected_patterns (
  id               uuid  PK DEFAULT gen_random_uuid(),
  user_id          uuid  NOT NULL → auth.users.id,
  pattern_type     text  NOT NULL,    -- e.g. 'gym_days', 'weekly_review_time', 'stale_goal'
  description      text  NOT NULL,
  last_detected_at timestamptz DEFAULT now(),
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
)
```

---

## 4. Claude Tool Registry

Tools are registered in `apps/web/src/lib/chat/tools/registry.ts`. Each tool has: a name, a JSON Schema input definition, and a handler in `tools/handlers/`. The chat engine checks `tool_permissions` before including any tool in the Claude API call.

### Phase 1 — Current Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task with title, description, priority, due date |
| `update_task` | Update any field on an existing task |
| `list_tasks` | Query tasks by status, priority, due date range |
| `add_reminder` | Add a reminder to a task at a specific time |
| `remove_reminder` | Remove a specific reminder from a task |
| `snooze_reminder` | Snooze a reminder by duration (15m, 1h, 1d) |
| `delete_task` | Permanently delete a task and its reminders |

### Phase 2 — Memory Tools

| Tool | Description |
|------|-------------|
| `save_memory` | Explicitly store a fact Claude learned about the user. Input: `{entity, content, tags}` |
| `recall_memories` | Semantic search over stored memories. Input: `{query, limit}`. Returns top matches. |
| `update_user_context` | Upsert a key/value in `user_context`. Input: `{key, value}` |
| `summarize_conversation` | Write a summary of the current session to `conversation_summaries`. Called at end of long sessions. |

### Phase 3 — Goal Tools

| Tool | Description |
|------|-------------|
| `create_goal` | Create a goal under a life area. Input: `{life_area_id, title, why_it_matters, success_metrics, target_date}` |
| `update_goal` | Update goal status, confidence, momentum, or fields. |
| `list_goals` | List goals filtered by life area, status, or momentum. |
| `set_goal_momentum` | Update momentum indicator. Input: `{goal_id, momentum, reasoning}` |
| `create_project` | Create a project, optionally linked to a goal. |
| `generate_daily_briefing` | Trigger briefing generation on demand (also runs on cron). |

### Phase 4 — Communications Tools

| Tool | Description |
|------|-------------|
| `list_emails` | Query `email_metadata` by urgency, date range, has_action_item. Returns summaries only (not body). |
| `get_email_thread` | Fetch full thread body from Gmail/Outlook on demand. |
| `create_email_draft` | Write a draft email and insert into `approval_queue`. |
| `submit_for_approval` | Insert any action into `approval_queue` for user review. |
| `list_calendar_events` | Query upcoming events from `calendar_events`. |
| `get_meeting_prep` | Generate or retrieve a meeting prep brief for an event. |

### Phase 5 — Proactive Tools

| Tool | Description |
|------|-------------|
| `generate_weekly_review` | Produce structured week-in-review (wins, blockers, next week focus). |
| `detect_patterns` | Analyze task history and surface behavioral patterns to `detected_patterns`. |
| `push_notification` | Send a tray notification from within a chat or cron context. |

---

## 5. Memory Architecture

The memory system is the backbone of "Claude that actually knows you." It uses three layers:

### Layer 1: Semantic Memory (`memories` table)

Facts extracted from conversations, stored with embeddings for similarity retrieval.

**Write path:** Claude calls `save_memory` tool when it learns a durable fact. Can also be batch-extracted at conversation end via `summarize_conversation`.

**Read path:** On every chat request:
1. Embed the user's message using `text-embedding-3-small` (OpenAI; 1536 dims, cheaper than Claude embeddings).
2. Query `memories` with `ORDER BY embedding <=> $1 LIMIT 5` (cosine distance via pgvector).
3. Increment `access_count` and update `last_accessed_at` for retrieved rows.
4. Inject results as system context prefix.

**Retrieval SQL:**
```sql
SELECT content, entity, tags
FROM memories
WHERE user_id = $1
ORDER BY embedding <=> $2::vector
LIMIT 5;
```

### Layer 2: Working Memory (`conversation_summaries`)

After a conversation exceeds ~20 turns or when the session ends, generate a summary and store it. Inject the last 3 summaries as system context to give Claude continuity across sessions without re-reading full history.

### Layer 3: Structured Context (`user_context`)

Key/value store for facts that aren't memories but aren't tasks either: `communication_style`, `writing_samples`, `key_relationships`, `dietary_restrictions`, etc. Injected as a structured block in system prompt.

### Memory System Prompt Injection Template

```
## What I know about you

### Facts I've learned:
- [memory 1: content]
- [memory 2: content]
...

### Context:
- Communication style: [user_context.communication_style]
- Key relationships: [user_context.key_relationships]

### Recent conversation history (last 3 session summaries):
[summary 1]
[summary 2]
[summary 3]
```

---

## 6. Daily Briefing System

### Generation

**Trigger:** Vercel Cron Job at 7:00 AM user's timezone (configured in `vercel.json`).

**Cron endpoint:** `POST /api/cron/daily-briefing` (protected with `CRON_SECRET` header).

**Generation prompt context:**
- Goals: all active goals with momentum indicator
- Tasks: due today, overdue, and due in next 3 days
- Memory: top 5 relevant memories (queried with "what's important today" embedding)
- Emails (Phase 4+): critical + high urgency received overnight
- Calendar (Phase 4+): meetings today with attendees
- Patterns (Phase 5+): any stale goals or detected nudges

**Storage:** Inserted into `daily_briefings`. Tray daemon polls `/api/briefing/today` every time it starts and at noon, fires a Windows toast if `was_delivered = false`.

**Briefing format:**
```markdown
# Good morning, [name]. Here's your day.

## Goals in focus
- **Lose 100 lbs** (improving) — Gym session scheduled tonight
- **Finish Q3 project** (stalled) — No tasks completed in 4 days ⚠️

## Due today
- Submit expense report (urgent)
- Call Dr. Chen (high)

## Coming up (next 3 days)
- [...]

## Overnight email (Phase 4+)
- 2 messages need action: [summaries]

## Today's calendar (Phase 4+)
- 2pm: Product review with Sarah, James
```

---

## 7. Email Intelligence Architecture

### Data Flow

```
Gmail API (poll every 15 min via Vercel Cron)
  ↓
Fetch new message IDs + headers (no body yet)
  ↓
Claude triage call (batch): classify each email
  - urgency: critical | high | normal | low
  - has_action_item: bool
  - action_item_summary: text
  - one-line summary
  ↓
Store to email_metadata (no body stored in DB)
  ↓
/email page: inbox view with AI categorization
```

**Body fetching:** Full email bodies are fetched from Gmail API on-demand only (when user opens an email or Claude calls `get_email_thread`). They are not stored in the database — privacy and token cost.

### Follow-Up Detection

Nightly cron: query `email_metadata` for threads where the last message is from the user, received > 3 days ago, with no subsequent reply. Insert candidates into `detected_patterns` (type: `follow_up_needed`).

### Draft → Approval → Send Flow

```
User: "Reply to Sarah's email declining the meeting"
  ↓
Claude: drafts email text
  ↓
Claude calls submit_for_approval({action_type: 'send_email', payload: {to, subject, body}})
  ↓
approval_queue row inserted (status: 'pending')
  ↓
Tray notification: "Email draft ready for approval"
  ↓
User opens /approvals, reviews, clicks Approve
  ↓
API route: updates status to 'approved', writes audit_log
  ↓
Webhook to n8n → n8n calls Gmail API to send
  ↓
Confirmation: status updated to 'executed'
```

---

## 8. Tray Daemon

### What It Does

The tray daemon is a lightweight Node.js process that runs silently on Windows, polls the Vercel API, and fires system notifications. It has no visible UI — only a tray icon with a right-click menu.

### Architecture

```typescript
// apps/tray/src/index.ts — top-level loop
async function main() {
  await loadAuth();         // read session from disk
  await registerStartup();  // Windows registry key (once)
  startTray();              // tray icon + context menu
  startPoller();            // poll loop
}
```

### Polling Loop (Phase 1 completion)

```typescript
// apps/tray/src/poller.ts
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function poll() {
  const { reminders } = await fetch(`${API_BASE}/api/tasks/due`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  }).then(r => r.json());

  for (const reminder of reminders) {
    await fireNotification(reminder);
    await fetch(`${API_BASE}/api/tasks/reminders/${reminder.id}/dismiss`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
  }
}
```

### Notification Actions

Windows toast notifications support action buttons. The poller fires a notification with three buttons:

| Button | Action |
|--------|--------|
| Dismiss | PATCH reminder `is_dismissed = true` |
| Snooze 15m | PATCH reminder `snoozed_until = now() + 15m` |
| Snooze 1h | PATCH reminder `snoozed_until = now() + 1h` |

### API Endpoint: `/api/tasks/due`

```typescript
// Query: task_reminders where remind_at <= now() AND snoozed_until IS NULL OR snoozed_until < now() AND is_dismissed = false
// Returns: [{id, task_id, task_title, remind_at}]
```

### Windows Auto-Start

```typescript
// apps/tray/src/startup.ts
import { execSync } from 'child_process';

export function registerStartup(exePath: string) {
  execSync(
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "PersonalAssistant" /t REG_SZ /d "${exePath}" /f`
  );
}
```

---

## 9. Phased Roadmap

### Phase 1 — Foundation Completion

**Timeline:** ~1 week  
**Goal:** Running, deployed, used daily

#### Remaining work

| Task | Detail |
|------|--------|
| Tray poller | Implement `poller.ts` — poll `/api/tasks/due` every 5 min |
| Toast notifications | Wire `node-notifier` with Dismiss/Snooze15m/Snooze1h action buttons |
| `/api/tasks/due` endpoint | Query `task_reminders` where `remind_at <= now() AND (snoozed_until IS NULL OR snoozed_until < now()) AND is_dismissed = false` |
| Windows startup | Write registry key on first run |
| Vercel deployment | Deploy `apps/web` to Vercel production, configure env vars |

#### Acceptance criteria

- [ ] Create a task in the browser with a reminder set 2 minutes from now
- [ ] Within 5 minutes, a Windows toast notification fires without the browser open
- [ ] Clicking "Snooze 15m" on the toast snoozes the reminder and no second notification fires immediately
- [ ] Clicking "Dismiss" marks the reminder dismissed and it never fires again

---

### Phase 2 — Persistent Memory Layer

**Timeline:** ~2 weeks  
**Goal:** Claude remembers facts across conversations

#### Work items

| Task | Detail |
|------|--------|
| Enable pgvector | `CREATE EXTENSION vector;` in Supabase migration |
| DB migration | Create `memories`, `user_context`, `conversation_summaries` tables with indexes |
| Embedding service | `apps/web/src/lib/memory/embed.ts` — wraps OpenAI `text-embedding-3-small` API |
| Memory retrieval | `apps/web/src/lib/memory/retrieve.ts` — embed query, cosine search, return top-5 |
| Context injection | Modify chat engine to prepend memory context to system prompt before every call |
| `save_memory` tool | Claude calls on learning a durable fact |
| `recall_memories` tool | Claude explicitly queries memory when answering questions about the user |
| `update_user_context` tool | Upsert structured context (writing style, relationships, preferences) |
| `summarize_conversation` tool | Write session summary after long conversations |
| Memory settings page | `/memory` page: list all stored memories, edit content, delete rows |
| Conversation summary cron | Optional: nightly cron to summarize conversations older than 24h |

#### Acceptance criteria

- [ ] In Conversation A: say "My dog's name is Biscuit and she's a golden retriever"
- [ ] In Conversation B (new session): ask "What's my dog's name?" — Claude answers "Biscuit" without being told again
- [ ] `/memory` page shows the stored memory about Biscuit
- [ ] Deleting the memory from the page means the next conversation does not know the dog's name

---

### Phase 3 — Goal-Driven Organization

**Timeline:** ~2 weeks  
**Goal:** Life OS dashboard replaces task-list mentality

#### Work items

| Task | Detail |
|------|--------|
| DB migration | Create `life_areas`, `goals`, `projects`, `daily_briefings` tables |
| Tasks migration | Add `project_id` and `goal_id` nullable FK columns to `tasks` |
| `/goals` page | Life areas as columns (kanban-style), goals as cards with momentum indicator (arrow icon: improving/stable/declining) |
| `/goals/[id]` page | Goal detail: why_it_matters, success_metrics, linked projects, linked tasks, recommended next actions from Claude |
| `/projects/[id]` page | Project detail: linked goal, tasks list, status |
| Task form update | Add optional project/goal assignment dropdowns |
| Goal tools | `create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project` |
| Daily briefing generation | `apps/web/src/lib/jobs/briefing.ts` — takes user context, goals, due tasks, generates markdown briefing |
| Vercel cron | `vercel.json` cron at 7am UTC (adjust per user timezone stored in `user_context`) |
| `generate_daily_briefing` tool | On-demand briefing generation from chat |
| Tray briefing delivery | Tray polls `/api/briefing/today` on startup and at noon |

#### Acceptance criteria

- [ ] Create life area "Health", create goal "Lose 100 lbs" with why_it_matters and success_metrics
- [ ] Create task "Go to gym" and link it to the goal
- [ ] `/goals` page shows Health column with the goal card and a "stable" momentum indicator
- [ ] Mark momentum as "improving" via chat: "I've been consistent with the gym this week"
- [ ] By 7:05am next morning, receive a tray notification with a briefing mentioning the Health goal and today's gym task

---

### Phase 4 — Communications Intelligence

**Timeline:** ~3 weeks  
**Goal:** Email triage saves 10+ hours/week

#### Work items

| Task | Detail |
|------|--------|
| DB migration | Create `integrations`, `email_metadata`, `calendar_events`, `approval_queue`, `audit_log` |
| Gmail OAuth flow | Settings page → "Connect Gmail" → OAuth2 consent → store encrypted tokens in `integrations` |
| Token encryption | Use AES-256-GCM with a `DATA_ENCRYPTION_KEY` env var. Encrypt before insert, decrypt after select. |
| Email poll cron | Every 15 min: fetch new emails (headers only), run Claude triage batch, store to `email_metadata` |
| `/email` page | Inbox view: urgency badges, AI summaries, action-item flags. Click to fetch full thread on demand. |
| Follow-up detection | Nightly cron: query threads where user sent last, > 3 days ago |
| Email draft flow | Claude writes draft → `submit_for_approval` tool → approval_queue row → user approves → n8n sends |
| `/approvals` page | List pending items from `approval_queue`, approve/reject each |
| Tray approval notification | When new row inserted in approval_queue, fire toast "Action waiting for approval" |
| Google Calendar OAuth | Connect Calendar → store tokens → sync to `calendar_events` |
| Calendar sync cron | Every hour: fetch events for next 7 days, upsert to `calendar_events` |
| Meeting prep | 15 min before event: cron generates brief from related emails + tasks + memories → toast notification |
| n8n setup | Self-hosted n8n (local or VPS). Single webhook node receives approved-action payloads. Gmail Send node. Calendar Write node. |
| Email tools | `list_emails`, `get_email_thread`, `create_email_draft`, `submit_for_approval` |
| Calendar tools | `list_calendar_events`, `get_meeting_prep` |

#### Acceptance criteria

- [ ] Connect Gmail in settings; emails appear in `/email` page within 15 minutes with urgency classification
- [ ] Ask Claude "Draft a reply to Sarah declining tomorrow's meeting" → approval queue shows the draft → approve it → email is sent
- [ ] 15 minutes before a calendar meeting, receive a tray notification with a prep brief listing relevant emails and talking points
- [ ] Threads awaiting follow-up are flagged in `/email` after 3 days of no reply

---

### Phase 5 — Proactive Intelligence

**Timeline:** ~2 weeks  
**Goal:** Assistant initiates, not just responds

#### Work items

| Task | Detail |
|------|--------|
| DB migration | Create `detected_patterns` table |
| Pattern detection cron | Nightly: analyze task completion history, identify habits (gym frequency, review consistency). Store to `detected_patterns`. |
| Stale goal nudges | Cron checks goals where last linked task completed > 7 days ago, fires tray notification |
| Weekly review cron | Friday 5pm: generate structured review (wins, blockers, next week focus) → store in `daily_briefings` (type: 'weekly') → tray notification |
| Cross-context query | Modify chat engine to query email + tasks + memories together when answering questions like "what's been happening with [project]" |
| Proactive tools | `generate_weekly_review`, `detect_patterns`, `push_notification` |
| Pattern notification | When a new pattern is detected, fire a subtle informational tray notification |

#### Acceptance criteria

- [ ] Stop completing tasks linked to a goal for 7 days; receive a tray notification "Your [goal] goal hasn't had activity in 7 days"
- [ ] On Friday at 5pm, receive a tray notification with a weekly review; it accurately lists completed tasks and identifies a blocker
- [ ] Ask Claude "What's been happening with my gym project?" — Claude queries emails, tasks, and memories to give a coherent summary without being prompted with context

---

### Phase 6 — Productization

**Timeline:** When ready  
**Goal:** Multi-user, subscription billing; onboarding a new user without help

#### Work items

| Task | Detail |
|------|--------|
| Stripe integration | Webhook-driven subscription management. Store `subscription_tier` in `profiles`. |
| Tier enforcement | Free: 1 life area, 3 goals, no email integration. Pro: unlimited + email + calendar. Team: multi-user org. |
| Usage limits | Middleware checks `subscription_tier` before tool execution and page access. |
| Onboarding flow | 4-step wizard: connect email → define life areas → create first goal → create first task. |
| Team auth | Supabase org-level RLS — shared records with `org_id` in addition to `user_id`. |
| PWA | Add `next-pwa`, service worker, Web Push Notifications for mobile. |
| Mac/Linux tray | Abstract `apps/tray` platform layer; add `node-mac-notifier` and Linux `libnotify` paths. |

#### Acceptance criteria

- [ ] New user signs up, completes 4-step onboarding, has first goal and task created
- [ ] Free user sees upgrade prompt when attempting to connect email
- [ ] Pro user on mobile receives a Web Push notification for a due reminder

---

## 10. Key Technical Decisions

### Memory: Supabase pgvector

**Decision:** Use pgvector on Supabase for semantic memory retrieval. Embeddings generated by OpenAI `text-embedding-3-small`.

**Rationale:**
- Same stack, same RLS, no new vendor
- One SQL query combines semantic retrieval with user-scoped filtering
- `text-embedding-3-small` is 1536 dims, ~$0.02 per 1M tokens — orders of magnitude cheaper than generating via Claude
- pgvector's `ivfflat` index makes cosine search fast at small scale (< 100k rows per user)

**Alternative considered:** Pinecone, Weaviate, dedicated vector DB. Rejected: adds a vendor, removes RLS guarantees, adds latency, adds cost.

### Daily Briefing: Vercel Cron

**Decision:** Vercel Cron Job runs at 7am, calls an internal API route protected by `CRON_SECRET`, stores result in `daily_briefings` table, tray daemon fetches it.

**Rationale:**
- Zero infrastructure: no separate scheduler process, no worker queue
- Stored result means tray can fetch it any time (startup, noon check) rather than generating on-demand
- Natural separation: generation is a background job, delivery is tray's responsibility

**Timezone handling:** Store user timezone in `user_context`. Cron runs at UTC; route checks `user_context.timezone` and skips if it's not within the 7am window for that user.

### Email: OAuth + Polling (No Webhooks)

**Decision:** Poll Gmail every 15 minutes via Vercel Cron. No push webhooks.

**Rationale:**
- Gmail push requires a publicly reachable HTTPS endpoint and a pub/sub subscription — adds infra
- 15-minute polling is acceptable for a personal assistant (not a real-time inbox)
- Full email bodies fetched on-demand only — reduces DB size and protects privacy

**Token storage:** Access and refresh tokens encrypted with AES-256-GCM before storing in `integrations`. Decrypted in server-side code only (never sent to client).

### n8n: Self-Hosted, Phase 4 Only

**Decision:** Run n8n locally or on a cheap VPS (e.g., Hetzner CX11 at ~$4/month). It receives webhooks only for approved actions.

**Rationale:**
- n8n has 400+ nodes covering every API integration needed through productization
- Self-hosted avoids n8n Cloud pricing; at personal scale, the VPS pays for itself in time saved
- Interface boundary is clean: the assistant calls `submit_for_approval`, n8n executes the approved action. Swapping n8n for direct API calls later doesn't change the assistant's code.

**Phase 4 Start option:** If n8n feels like overkill initially, implement direct Gmail API calls from server actions for Phase 4 launch. The `approval_queue` table and the approval UI are the same regardless. n8n just replaces the send logic.

### Mobile: PWA First

**Decision:** Web Push Notifications + PWA manifest before any native app.

**Rationale:**
- No app store submission, no React Native complexity, no separate codebase
- `next-pwa` adds service worker support in ~50 lines of config
- Web Push works on Android Chrome and is improving on iOS (Safari 16.4+)
- If native is later required, the backend API is already ready

### Approval Gates: `approval_queue` Table

**Decision:** Every external write action (email send, calendar write, third-party API call) goes through the `approval_queue` table before execution.

**Implementation invariant:**
1. Claude tool calls `submit_for_approval({action_type, description, payload})`
2. Row inserted with `status = 'pending'`
3. Tray notification fired
4. User goes to `/approvals`, reviews, approves or rejects
5. On approve: authenticated server action sets `status = 'approved'`, writes `audit_log`, fires n8n webhook
6. n8n webhook executes the action, status updated to `'executed'`

**No exceptions.** Claude cannot directly call external APIs. The separation is enforced at the architecture level.

---

## 11. Competitive Differentiation

| Feature | This project | Notion | Things/Todoist | Motion | Mem |
|---------|-------------|--------|----------------|--------|-----|
| Goal hierarchy (Life Area → Goal → Project → Task) | Yes | Partial (DIY) | No | No | No |
| Persistent semantic memory | Yes (Phase 2) | No | No | No | Yes |
| Email triage built-in | Yes (Phase 4) | No | No | No | No |
| Approval gates (trust-first) | Yes | No | No | No | No |
| Daily briefing from goals + email + tasks | Yes (Phase 3) | No | No | No | No |
| Proactive nudges on stale goals | Yes (Phase 5) | No | No | No | No |
| Self-hostable | Yes (Supabase) | No | No | No | No |
| Organizes by *why*, not just *what* | Yes | No | No | No | No |

The strongest differentiation: **goal hierarchy is genuinely novel at this integration level.** No competitor organizes around *why* while simultaneously triaging email, maintaining memory, and generating daily briefings from the combined context.

---

## 12. Open Questions and Deferred Features

### Medication Tracking

Mentioned in brainstorming. Could be a dedicated `medications` table with time-of-day reminders, separate from task reminders. High personal value if needed. Deferred until Phase 1 is fully used daily — determine whether task reminders cover this use case.

### Research Assistant

Claude with web search tool (via tool use + a search API like Brave Search or Tavily). Near-term add-on in Phase 2 or 3 if web research is frequently needed from chat. Implementation: add `web_search` tool to registry, wire to Brave Search API. No new tables required.

### Voice Interface

Web Speech API for voice input; Claude TTS or ElevenLabs for spoken briefings. Phase 5+ when the briefing system is mature. Mobile-primary feature.

### Local LLM Fallback

Ollama for privacy-sensitive queries (medical, financial). Phase 6+. Tool registry would need a routing layer to direct queries to local vs. cloud model based on content classification.

### MCP Server Exposure

Expose the assistant's tools (tasks, goals, memory, approvals) via Model Context Protocol so Claude Code and other MCP clients can use it. The tool registry's JSON Schema definitions are already MCP-compatible with minimal adaptation. Interesting long-term, deferred — doesn't add user value until productization.

### Mac/Linux Tray Support

Abstract the platform notification layer in `apps/tray`. Add `node-mac-notifier` and `libnotify` (Linux) paths behind a platform check. Deferred until productization requires it.

### Team / Shared Contexts

Phase 6+. Requires `org_id` on shared records, org-level RLS policies, and role management. Supabase Auth supports this natively.

---

## 13. Environment Variables Reference

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only, never sent to client

# Anthropic
ANTHROPIC_API_KEY=

# OpenAI (for embeddings only — Phase 2+)
OPENAI_API_KEY=

# Cron security
CRON_SECRET=                      # random 32+ char string; sent as header by Vercel Cron

# Data encryption (for OAuth tokens — Phase 4+)
DATA_ENCRYPTION_KEY=              # 32-byte hex string for AES-256-GCM

# n8n (Phase 4+)
N8N_WEBHOOK_URL=                  # base URL of self-hosted n8n instance
N8N_WEBHOOK_SECRET=               # shared secret to verify requests are from the app

# Tray daemon (in apps/tray/.env)
API_BASE=                         # https://your-app.vercel.app
SUPABASE_URL=                     # same as NEXT_PUBLIC_SUPABASE_URL
```

---

## 14. Jobs-to-Be-Done Reference

This table maps user needs to the system jobs that serve them, across all phases.

| User need | Job | Phase | Delivery |
|-----------|-----|-------|----------|
| Don't forget things | Reminder polling + toast notification | 1 | Tray |
| Remember context across sessions | Memory layer | 2 | Chat |
| Know what to focus on | Daily briefing | 3 | Tray + Chat |
| Track goals, not just tasks | Goal hierarchy | 3 | Web UI |
| Handle email without drowning | Email triage | 4 | Web UI + Tray |
| Be ready for meetings | Meeting prep brief | 4 | Tray |
| Trust that AI won't do things without permission | Approval gates | 4 | Web UI |
| Stay on track with long-term goals | Stale goal nudges | 5 | Tray |
| Understand patterns in how I work | Pattern detection | 5 | Tray + Chat |
| Review the week, plan the next one | Weekly review | 5 | Tray |
| Share with team | Multi-user orgs | 6 | Web UI |
