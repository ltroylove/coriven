# Personal Assistant — Implementation Plan

**Date:** 2026-06-19  
**Status:** Approved  
**Design doc:** `2026-06-19-personal-assistant-design.md`

Eight phases, each independently testable before moving to the next.

---

## Phase 1 — Monorepo Scaffolding

1. Initialize git repo, create `apps/web`, `apps/tray`, `packages/types` directories
2. Root `package.json` with npm workspaces
3. Root `tsconfig.json` with path aliases; per-app `tsconfig.json` files extending it
4. Scaffold `apps/web` as a Next.js 15 app (App Router, TypeScript, Tailwind 4)
5. Scaffold `apps/tray` as a bare Node.js TypeScript project
6. Create `packages/types` with shared type stubs (Task, Reminder, ToolPermission)
7. Add `.env.example`, `.gitignore`, `CLAUDE.md`

**Checkpoint:** `npm run dev` starts Next.js, tray compiles without errors.

---

## Phase 2 — Supabase & Database

1. Initialize Supabase CLI (`supabase init`), link to existing Supabase org
2. Write migration: `profiles`, `tasks`, `reminders`, `tool_permissions`, `conversation_messages`
3. Add RLS policies to all tables (`user_id = auth.uid()`)
4. Add all enum types (`task_status`, `task_priority`, `recurrence_type`, `message_role`)
5. Run migration locally (`supabase start` + `supabase db push`)
6. Generate TypeScript types (`supabase gen types typescript --linked > apps/web/src/types/supabase.ts`)

**Checkpoint:** All tables exist locally with correct RLS.

---

## Phase 3 — Authentication

1. Add 4 Supabase client variants to `apps/web/src/lib/supabase/` (mirror PrepForge pattern)
2. Add middleware for session refresh on every request
3. Build `/auth/signin` page (email/password)
4. Add auth guard to `(app)` layout — redirect to `/auth/signin` if not authenticated
5. Create user account via Supabase dashboard, verify login works end-to-end

**Checkpoint:** Can log in, protected routes redirect unauthenticated users.

---

## Phase 4 — Task API & UI

1. API routes: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/[id]`
2. Server Actions for task mutations
3. `packages/types` — finalize `Task` type
4. UI: task list page, task card component, create/edit form
5. Filtering by status and priority
6. Wire create/edit/delete end-to-end

**Checkpoint:** Can create, view, edit, and delete tasks in the browser.

---

## Phase 5 — Reminder API & UI (with snooze + recurrence)

1. API routes: `GET/POST /api/reminders`, `PATCH/DELETE /api/reminders/[id]`, `/snooze`, `/advance`, `/due`
2. Recurrence logic: `getNextOccurrence(reminder)` utility in `packages/types` — computes next `remind_at` based on `recurrence_type`
3. UI: reminder list page, reminder form (with recurrence picker + snooze controls)
4. Wire create/edit/delete/snooze end-to-end
5. Test `GET /api/reminders/due` returns correct upcoming reminders

**Checkpoint:** Can create recurring reminders, snooze them, and `/due` endpoint returns the right data.

---

## Phase 6 — Chat Engine & Tool Use

1. Add Anthropic SDK to `apps/web`, create `src/lib/anthropic.ts` with model constants (mirror PrepForge)
2. Build tool registry in `src/lib/chat/tools/registry.ts` — define all 7 tools: `create_task`, `update_task`, `list_tasks`, `create_reminder`, `list_reminders`, `snooze_reminder`, `delete_reminder`
3. Implement each tool handler — calls the same logic as the API routes
4. Build `src/lib/chat/engine.ts` — loads user's enabled tools, calls Claude, handles tool calls, streams response
5. Add `POST /api/chat/route.ts` — SSE streaming endpoint
6. Seed default `tool_permissions` rows for new users (all disabled by default)
7. UI: chat page with streaming message display and tool-call indicator
8. UI: settings page with tool permission toggles (`PATCH /api/tools/[toolName]`)
9. Test: enable `create_task` tool, ask Claude to "add a task to call dentist tomorrow"

**Checkpoint:** Claude can create tasks and reminders through chat, tool permissions toggle works.

---

## Phase 7 — Tray Daemon

1. Add `node-systray` and `node-notifier` to `apps/tray`
2. Build `auth.ts` — `signInWithPassword`, store/refresh token in `~/.personal-assistant/session.json`
3. Build `cache.ts` — read/write upcoming reminders to `~/.personal-assistant/cache.json`
4. Build `poller.ts` — polls `GET /api/reminders/due` every 5 minutes, updates cache
5. Build `notifier.ts` — checks cache every 1 minute, fires toast for due reminders, calls `/snooze` or `/advance` on user action
6. Build `tray.ts` — system tray icon, right-click menu (Open App, Snooze All, Quit)
7. Build `index.ts` — wires everything together, handles startup
8. Register as Windows startup item
9. Test: create a reminder due in 2 minutes, close the browser, verify toast fires

**Checkpoint:** Reminders fire as Windows toasts with browser closed. Snooze and recurrence advance work.

---

## Phase 8 — Deploy

1. Create new Vercel project in same org as PrepForge
2. Set all environment variables in Vercel dashboard
3. Connect Supabase project (production) — run migrations against production DB
4. Push to `main` → verify Vercel deployment
5. Update tray daemon's API base URL to point to Vercel URL
6. Build tray daemon as standalone executable (`esbuild` bundle)
7. Test full flow in production: create task via web, get reminded via tray

**Checkpoint:** Everything works end-to-end in production.
