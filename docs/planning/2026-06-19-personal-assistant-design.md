# Personal Assistant — Design Document

**Date:** 2026-06-19  
**Status:** Approved  
**First milestone:** Task & reminder engine

---

## 1. Vision

An AI-powered personal assistant built for personal use first, with every architectural decision made to enable productization later without rewrites.

**End-state feature set:**
- **A) Life/schedule management** — reminders, calendar, tasks, daily briefings
- **B) Knowledge & research companion** — answers questions, summarizes, remembers context
- **C) Automation hub** — runs workflows, talks to APIs, acts on behalf of user

**First milestone scope:** Task & reminder engine — create/manage tasks, set reminders, interact via chat with Claude using tool use.

**Build philosophy:** Personal use first. Build clean, not big. Productization-friendly choices made upfront at near-zero cost.

---

## 2. Architecture

### Overview

Two processes — a Next.js web app deployed to Vercel, and a lightweight tray daemon running locally on Windows.

```
┌─────────────────┐          ┌──────────────────────────┐
│   Your Machine  │          │         Cloud            │
│                 │          │                          │
│  ┌───────────┐  │  HTTPS   │  ┌────────────────────┐  │
│  │   Tray    │──┼──────────┼─►│  Next.js on Vercel │  │
│  │  Daemon   │  │          │  │  API routes + UI   │  │
│  └───────────┘  │          │  └─────────┬──────────┘  │
│                 │          │            │              │
│  Browser ───────┼──────────┼────────────┤              │
│                 │          │  ┌─────────▼──────────┐  │
└─────────────────┘          │  │     Supabase       │  │
                             │  │  Postgres + Auth   │  │
                             └──┴────────────────────┘
```

- **Next.js app** — web UI + API routes, deployed to Vercel. Open in browser when you want to interact.
- **Tray daemon** — lightweight Node.js process, starts on Windows login, polls the Vercel API for due reminders, fires Windows toast notifications. No visible window.
- **Supabase** — managed Postgres + Auth. RLS enforces data isolation per user from day one.

### Monorepo Structure

```
apps/
  web/          ← Next.js 15 app (UI + API routes) → deployed to Vercel
  tray/         ← Node.js background daemon → installed on your machine
packages/
  types/        ← shared TypeScript types (tasks, reminders, tools)
supabase/
  migrations/   ← SQL-first migrations (same pattern as PrepForge)
```

### Productization-Friendly Rules (non-negotiable)

- **API-first** — UI always calls API routes, never touches Supabase directly from components
- **Auth from day one** — login layer exists even for single user
- **`user_id` on every table** — RLS policies enforce isolation; multi-tenancy is already done
- **Supabase ORM abstraction** — schema in migrations, types auto-generated; swap nothing when scaling
- **Web-first UI** — browser today → PWA for mobile → Electron/Tauri wrapper later if needed

---

## 3. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 15 (App Router) | Same as PrepForge; API routes + React in one repo |
| Language | TypeScript (strict) | End-to-end type safety; better for agentic development |
| Styling | Tailwind CSS 4 | Same as PrepForge |
| Database | Supabase (Postgres) | Managed, scales, built-in auth, same as PrepForge |
| Auth | Supabase Auth + SSR | Same 4-client pattern as PrepForge |
| AI | Anthropic Claude API | Tool use (function calling) for agentic actions |
| Hosting | Vercel | Same org as PrepForge; auto-deploy from main |
| Tray | node-systray + node-notifier | Windows system tray + toast notifications |
| Bundler (tray) | esbuild / pkg | Standalone executable for distribution |

---

## 4. Data Model

All tables follow Supabase conventions. `auth.users` is managed by Supabase. RLS policy on every table: `user_id = auth.uid()`.

```sql
-- Extends Supabase auth.users
profiles
  id          uuid  PK → auth.users.id
  email       text
  name        text
  created_at  timestamptz

tasks
  id          uuid  PK
  user_id     uuid  → auth.users.id
  title       text
  description text?
  status      enum: pending | in_progress | done | cancelled
  priority    enum: low | medium | high | urgent
  due_at      timestamptz?
  completed_at timestamptz?
  created_at  timestamptz
  updated_at  timestamptz

reminders
  id                uuid  PK
  user_id           uuid  → auth.users.id
  task_id           uuid? → tasks.id   (optional — reminders exist independently of tasks)
  message           text
  remind_at         timestamptz
  fired             boolean  default false
  snoozed_until     timestamptz?  (set when user snoozes; tray ignores reminder until this passes)
  recurrence_type   enum: none | daily | weekdays | weekly | monthly | yearly  default none
  recurrence_end_at timestamptz?  (when recurrence stops; null = forever)
  last_fired_at     timestamptz?  (tracks when recurring reminder last fired)
  created_at        timestamptz

tool_permissions
  id          uuid  PK
  user_id     uuid  → auth.users.id
  tool_name   text  (e.g. "create_task", "web_search", "send_email")
  enabled     boolean  default false
  granted_at  timestamptz

conversation_messages
  id          uuid  PK
  user_id     uuid  → auth.users.id
  role        enum: user | assistant
  content     text
  tool_calls  jsonb?   (Claude tool calls + results, for context)
  created_at  timestamptz
```

**Migrations** in `supabase/migrations/` — SQL-first, idempotent, same workflow as PrepForge.  
**Types** auto-generated via `supabase gen types typescript --linked > src/types/supabase.ts`.

---

## 5. API Layer

All routes under `apps/web/src/app/api/`. Auth checked on every route via `createAuthServerClient()` + `getUser()` → 401 if no valid session.

```
api/
  auth/
    [...supabase]/route.ts     ← Supabase SSR auth callback
  tasks/
    route.ts                   ← GET (list), POST (create)
    [id]/route.ts              ← GET, PATCH, DELETE
  reminders/
    route.ts                   ← GET (list), POST (create)
    [id]/route.ts              ← PATCH, DELETE
    [id]/snooze/route.ts       ← POST { minutes: number } → sets snoozed_until
    [id]/advance/route.ts      ← POST → advances recurring reminder to next occurrence
    due/route.ts               ← GET due in next 24h (tray daemon polls this)
  chat/
    route.ts                   ← POST, SSE streaming
  tools/
    route.ts                   ← GET (list all tools + user opt-in status)
    [toolName]/route.ts        ← PATCH (toggle enabled/disabled)
```

---

## 6. Chat & Tool Use Layer

```
lib/chat/
  engine.ts          ← main loop: calls Claude, handles tool calls, streams response
  tools/
    registry.ts      ← all tool definitions exported as an array
    create-task.ts
    update-task.ts
    list-tasks.ts
    create-reminder.ts       ← supports recurrence_type + recurrence_end_at
    delete-reminder.ts
    snooze-reminder.ts
    list-reminders.ts
```

**Chat turn flow:**
1. User sends message
2. API route loads last N conversation messages + user's enabled tools from `tool_permissions`
3. Claude receives message + **only enabled tools** (disabled tools are never passed to Claude)
4. Claude responds — plain text streamed to user, or tool call → execute → feed result back → continue
5. Full exchange saved to `conversation_messages` including `tool_calls` jsonb

**Tool permission enforcement** — `engine.ts` filters the tool registry against the user's `tool_permissions` before every API call. Claude cannot call a tool it was never told about.

**Model routing** — same as PrepForge:
- `CHAT_MODEL_FAST` (Haiku) — simple task operations
- `CHAT_MODEL_SMART` (Sonnet) — complex reasoning, multi-step tool chains

**Tool definition shape:**
```typescript
export const createTaskTool = {
  name: "create_task",
  description: "Create a new task for the user",
  input_schema: {
    type: "object",
    properties: {
      title:    { type: "string" },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      due_at:   { type: "string", description: "ISO 8601 datetime, optional" }
    },
    required: ["title"]
  }
}
```

---

## 7. Tray Daemon

```
apps/tray/src/
  index.ts       ← entry point, starts all services
  tray.ts        ← system tray icon + context menu
  poller.ts      ← polls /api/reminders/due every 5 minutes
  notifier.ts    ← fires Windows toast notifications
  cache.ts       ← persists upcoming reminders to ~/.personal-assistant/cache.json
  auth.ts        ← reads + refreshes Supabase session token
```

**Startup flow:**
1. Windows login → tray daemon starts
2. Reads cached auth token from `~/.personal-assistant/session.json`
3. Polls `/api/reminders/due` → caches results locally
4. Every 5 min: re-polls API (if online), refreshes cache
5. Every 1 min: checks cache for reminders due now → fires toast notification
   - Skips reminders where `snoozed_until` is in the future
   - After firing a recurring reminder: calls API to advance `remind_at` to next occurrence and reset `fired = false`
6. Tray icon: right-click → Open App | Snooze All (15 min) | Quit
7. Toast notification actions: Dismiss | Snooze 15 min | Snooze 1 hour

**Offline handling:**
- If API unreachable → use last known cache
- Cache stores reminders up to 24 hours ahead
- Notifications fire from cache regardless of internet status

**Auth handoff:**
- Tray daemon uses Supabase JS client directly — calls `supabase.auth.signInWithPassword()` on first run, stores the refresh token in `~/.personal-assistant/session.json`
- On subsequent starts, uses the stored refresh token to restore the session without prompting
- Auto-refreshes the access token before expiry using the Supabase client's built-in refresh
- If token invalid or missing → tray icon shows warning, right-click → Sign In opens a prompt for email/password
- When productizing: replace with a PKCE OAuth flow (tray hosts a localhost callback server, opens browser for login)

---

## 8. Authentication

Supabase Auth end-to-end — identical pattern to PrepForge.

**4 Supabase client variants** in `apps/web/src/lib/supabase/`:

| Client | Used in |
|--------|---------|
| `client.ts` | Browser components, simple reads |
| `auth-client.ts` | Browser auth state (signin/signup) |
| `server.ts` | Server-only, service role, RLS bypass |
| `auth-server.ts` | Server Components, Actions, API routes |

**Web flow:** Middleware refreshes session on every request → redirect to `/auth/signin` if not authenticated.

**Tray flow:** Reads session from local file → uses Supabase JS client to refresh → attaches Bearer token to all API calls.

**Single user for now** — account created directly via Supabase dashboard. No public signup page. When productizing: enable signup, RLS handles multi-tenancy automatically.

---

## 9. Web UI

```
app/
  (auth)/
    signin/page.tsx
  (app)/
    layout.tsx               ← sidebar + nav, auth guard
    tasks/page.tsx           ← task list + filters
    tasks/[id]/page.tsx      ← task detail + edit
    reminders/page.tsx       ← reminder list
    chat/page.tsx            ← chat interface with Claude
    settings/page.tsx        ← profile + tool permission toggles

components/
  tasks/task-list.tsx, task-card.tsx, task-form.tsx
  reminders/reminder-list.tsx, reminder-form.tsx
  chat/chat-window.tsx, chat-input.tsx, tool-call-indicator.tsx
  settings/tool-permissions.tsx
```

**Settings page** — lists every registered tool with an on/off toggle. `PATCH /api/tools/[toolName]` updates the permission. Claude gains or loses access on the next message immediately.

**Styling** — Tailwind CSS 4, no component library. Easy to layer in shadcn/ui later.

---

## 10. Open Questions (Deferred)

- **Mobile strategy** — PWA vs React Native (deferred to later milestone)
- **Additional tools** — web search, email, calendar integration (future milestones)
- **Notification delivery on non-Windows** — Mac/Linux tray support (productization concern)
- **Conversation memory strategy** — first milestone uses last 20 messages as context window; summarization strategy deferred
- **Custom recurrence intervals** — e.g. "every 3 days", "every 2 weeks" (deferred; first milestone covers daily/weekdays/weekly/monthly/yearly)
