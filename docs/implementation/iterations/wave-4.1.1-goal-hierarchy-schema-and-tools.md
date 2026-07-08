---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "4"
feature: "4.1"
wave: "4.1.1"
agents: []
tags: [coriven, goals, schema, tools, migration, life-areas, projects]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
---

# Wave 4.1.1: Goal Hierarchy Schema & Tools

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 4.1.1 |
| Feature | 4.1 — Goal Hierarchy Schema & Tools |
| Epic | 4 — Goal-Driven Organization |
| Status | Planning |
| Scope | SQL migrations for `life_areas`, `goals`, `projects`, `daily_briefings`; nullable `project_id`/`goal_id` on `tasks`; goal-related tool definitions and handlers registered in the existing registry/handlers pattern |
| Wave Goal | Establish the complete goal-hierarchy data model and expose it to the Claude chat engine through typed tools, so subsequent waves can build UI and jobs on a stable foundation |

**Wave Philosophy.** Data first, behavior second — every wave in Epic 4 depends on this schema being correct and RLS-complete before anything else executes against it.

---

## Wave Goals

1. **Foundation completeness** — all five schema objects (`life_areas`, `goals`, `projects`, `daily_briefings`, plus `tasks` FK columns) land in a single atomic migration set, enabling every Epic 4 feature to build without further schema changes.
2. **Tool parity** — six goal/project tools (`create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project`, `generate_daily_briefing`) are registered, typed, and callable via the existing chat engine tool-use loop, consistent with the Business Requirements Feature 1 scope.
3. **Security coverage** — every new table carries `user_id` + RLS, matching the architecture invariant that no row is ever accessible to any user other than its owner (Architecture §Data Security).

---

## User Stories

### Story 4.1.1.1 — Goal Hierarchy Schema Migration

**As** the system owner,
**I want** the `life_areas`, `goals`, `projects`, and `daily_briefings` tables created with correct enums, foreign keys, and RLS policies,
**so that** goal-related data can be stored and queried with full per-user isolation.

**Acceptance Criteria:**

- `life_areas`, `goals`, `projects`, and `daily_briefings` tables exist with all columns defined in Architecture §14.3.
- `goals` carries `why_it_matters text`, `success_metrics text`, `status goal_status`, `confidence goal_confidence`, `momentum goal_momentum`, `last_activity_at timestamptz`, and `last_nudge_at timestamptz`.
- `daily_briefings` has a unique constraint on `(user_id, briefing_date)` so no duplicate briefing rows can be inserted for the same user/day.
- RLS is enabled on all four tables; the policy `user_id = auth.uid()` is applied for all operations.
- Enum types `goal_status ('active','achieved','paused','abandoned')`, `goal_confidence ('high','medium','low')`, and `goal_momentum ('improving','stable','declining')` are created before the tables that depend on them.
- All tables and indexes are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- Migration applies cleanly against the current local Supabase instance with no manual intervention.

**Priority:** High
**Estimated Hours:** 6h
**References:** Business Requirements Feature 1; Architecture §14.3; UC-6.

#### Task 4.1.1.1.1 — Enum and Table DDL Migration

**Parent Story:** 4.1.1.1
**Agent:** Backend/DB
**Estimation:** 6h
**Dependencies:** Existing migration `20260620140813_add_task_reminders_table.sql` must already be applied (Epic 1).
**Deliverables:** Migration file `supabase/migrations/YYYYMMDDHHMMSS_add_goal_hierarchy.sql`
**Acceptance Criteria:**
- Defines `goal_status`, `goal_confidence`, `goal_momentum` enums before first use.
- Creates `life_areas (id, user_id, name, color, icon, sort_order, created_at)`.
- Creates `goals (id, user_id, life_area_id, title, why_it_matters, success_metrics, status, confidence, momentum, last_activity_at, last_nudge_at, created_at, updated_at)` with FK to `life_areas`.
- Creates `projects (id, user_id, goal_id, title, description, status, created_at, updated_at)` with FK to `goals`.
- Creates `daily_briefings (id, user_id, briefing_date date, content jsonb, was_delivered boolean NOT NULL DEFAULT false, delivered_at timestamptz, created_at)` with `UNIQUE (user_id, briefing_date)`.
- Adds `project_id uuid REFERENCES projects(id) ON DELETE SET NULL` and `goal_id uuid REFERENCES goals(id) ON DELETE SET NULL` nullable columns to `tasks`.
- Index on `(user_id, status)` for `goals`; index on `(user_id, briefing_date)` for `daily_briefings`.
- RLS enabled with `FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` on all four new tables.
- `GRANT ALL ON TABLE ... TO anon, authenticated, service_role` present for each table, matching existing migration style.
- `update_updated_at` trigger applied to `goals` and `projects` (reuses the function already created in migration `20260619000001`).
- Migration verified locally with `npx supabase db push` and types regenerated to `apps/web/src/types/supabase.ts`.

---

### Story 4.1.1.2 — Goal Tool Definitions (Registry)

**As** a chat user,
**I want** goal and project management tools (`create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project`, `generate_daily_briefing`) available in the chat engine,
**so that** I can manage my goal hierarchy through natural-language conversation.

**Acceptance Criteria:**

- All six tool names are added to `ALL_TOOL_NAMES` in `registry.ts`.
- Each tool entry in `TOOL_REGISTRY` includes a description, all relevant properties, and a `required` array; input shapes match the handler implementations exactly.
- `create_goal` accepts `title`, `life_area_id`, `why_it_matters`, `success_metrics`, `status`, `confidence`; `title` required.
- `update_goal` accepts `id` (required) plus any subset of goal fields including `status` and `confidence`.
- `list_goals` accepts optional `life_area_id`, `status`, `limit`; returns goals with their linked project count.
- `set_goal_momentum` accepts `id` and `momentum`; intended for the nightly job but also callable in chat for manual override.
- `create_project` accepts `title`, `goal_id` (required), `description`, `status`.
- `generate_daily_briefing` accepts no required parameters; triggers on-demand briefing assembly for the requesting user.
- All tool names follow the existing snake_case convention.
- Disabled tools are never offered to the model (existing engine behavior; no regression).

**Priority:** High
**Estimated Hours:** 4h
**References:** Business Requirements Feature 1, Feature 3; Architecture §Tool Registry.

#### Task 4.1.1.2.1 — Extend `registry.ts` with Goal Tools

**Parent Story:** 4.1.1.2
**Agent:** Backend/AI
**Estimation:** 4h
**Dependencies:** Task 4.1.1.1.1 (schema must exist for type alignment); `@personal-assistant/types` `ToolName` union must be extended to include the six new names.
**Deliverables:** Updated `apps/web/src/lib/chat/tools/registry.ts`; updated `ToolName` in `packages/types/`.
**Acceptance Criteria:**
- `ToolName` union in `packages/types/` extended; `npm run typecheck` passes with zero errors.
- Each tool entry passes TypeScript strict-mode typing against the `Anthropic.Tool` interface.
- No previously existing tool definition is removed or altered.
- `generate_daily_briefing` tool description clearly states it assembles from structured data (no LLM), consistent with ADR-008.

---

### Story 4.1.1.3 — Goal Tool Handlers

**As** a chat user,
**I want** the six goal tools to execute correctly when Claude calls them,
**so that** I can create goals, link projects, and inspect goal state through the chat interface.

**Acceptance Criteria:**

- Each handler creates, updates, or queries its target table and returns a JSON result or a structured error message.
- `create_goal` inserts into `goals` with `user_id` from the authenticated session; returns the created row.
- `update_goal` updates only columns present in the input; guards against updating another user's row by including `eq('user_id', userId)`.
- `list_goals` joins `projects` to compute `project_count`; respects optional `life_area_id` and `status` filters; default `limit` of 20.
- `set_goal_momentum` updates `goals.momentum` for the given `id` belonging to the authenticated user.
- `create_project` inserts into `projects` with `user_id`; returns the created row.
- `generate_daily_briefing` calls the briefing-assembly service (stub returning `{ status: 'ok' }` in this wave; Feature 4.4 provides the full implementation) — handler does not call any LLM.
- All handlers are registered in the `HANDLERS` map in `handlers.ts`; `executeToolHandler` dispatches to them without modification.
- Handler errors return `{ is_error: true, content: '<descriptive message>' }` in every failure path.
- Service client (`createServiceClient`) is used for all DB writes, matching the existing handler pattern.

**Priority:** High
**Estimated Hours:** 8h
**References:** Business Requirements Feature 1; Architecture §Tool Registry; UC-6, UC-7.

#### Task 4.1.1.3.1 — Implement Goal Handlers in `handlers.ts`

**Parent Story:** 4.1.1.3
**Agent:** Backend/AI
**Estimation:** 8h
**Dependencies:** Task 4.1.1.1.1 (tables exist); Task 4.1.1.2.1 (tool names registered).
**Deliverables:** Updated `apps/web/src/lib/chat/tools/handlers.ts`.
**Acceptance Criteria:**
- Functions `handleCreateGoal`, `handleUpdateGoal`, `handleListGoals`, `handleSetGoalMomentum`, `handleCreateProject`, `handleGenerateDailyBriefing` implemented following the `async (input, userId) => HandlerResult` signature.
- No raw SQL; all DB access via the Supabase client builder pattern.
- `handleListGoals` uses a relational select to count associated projects (e.g., `goals.select('*, projects(count)')`).
- `handleGenerateDailyBriefing` stub returns `{ status: 'scheduled' }` to be replaced when Feature 4.4 ships.
- `npm run typecheck` passes; no `any` escape hatches introduced.

---

### Story 4.1.1.4 — Tool Permissions Seeded for Goal Tools

**As** the system owner,
**I want** `tool_permissions` rows to exist (default enabled) for the six new goal tools on my account,
**so that** the tools are immediately available in the chat engine without manual settings configuration.

**Acceptance Criteria:**

- A migration or seed script inserts a `tool_permissions` row with `enabled = true` for each of the six goal tools for the owner's user account using `ON CONFLICT (user_id, tool_name) DO NOTHING`.
- New beta users receive the same default rows when their account is created (the existing account-creation flow, wherever it runs, should upsert the six new permissions).
- No previously existing permission row is removed or altered.
- Settings UI continues to show the goal tool toggles accurately after the migration runs.

**Priority:** Medium
**Estimated Hours:** 2h
**References:** Business Requirements Feature 3 (disabled tools never offered to the model).

#### Task 4.1.1.4.1 — Default Permission Rows

**Parent Story:** 4.1.1.4
**Agent:** Backend/DB
**Estimation:** 2h
**Dependencies:** Task 4.1.1.1.1 (tool names must exist in the registry; no FK on `tool_name` but the seed must be consistent with the registry).
**Deliverables:** Seed logic in the goal hierarchy migration or a separate idempotent seed file.
**Acceptance Criteria:**
- Uses `INSERT INTO tool_permissions ... ON CONFLICT (user_id, tool_name) DO NOTHING` so re-runs are safe.
- Does not hard-code any specific user UUID; the seed targets the authenticated user via a function or is applied post-sign-up via the account-creation Server Action.

---

## Task Dependencies

```
Task 4.1.1.1.1  (enum + table DDL migration)
    └──► Task 4.1.1.2.1  (registry — ToolName type, tool definitions)
             └──► Task 4.1.1.3.1  (handlers — DB writes)
                      └──► Task 4.1.1.4.1  (permission seed — safe after schema + registry exist)
```

**Critical path:** schema → types/registry → handlers → seed. All tasks are sequential due to compile-time and runtime dependencies. No parallelizable streams in this wave.

---

## Definition of Done

- [ ] `npx supabase db push` applies the goal-hierarchy migration cleanly with no errors on a fresh local instance.
- [ ] `npx supabase gen types typescript --linked` runs and `apps/web/src/types/supabase.ts` reflects all four new tables and three new enums.
- [ ] `npm run typecheck` passes across the entire monorepo with zero type errors.
- [ ] A user can instruct Coriven via chat to "create a Health life area and add a goal Lose 100 lbs, because I want more energy" and the chat engine creates the records via `create_goal` with `why_it_matters` populated.
- [ ] `list_goals` tool returns the goal with its `project_count`.
- [ ] Attempting to access another user's goal via a tool call (by passing a foreign goal UUID) returns an error (RLS blocks the query).
- [ ] `npm run dev` starts without errors; Settings page shows the six new tool toggles.
- [ ] All six tools appear in tool-permission rows for the owner account.

---

## Infrastructure Specifications

### Database

**New tables (Architecture §14.3):**

- `life_areas` — `(id uuid PK, user_id uuid NOT NULL → auth.users ON DELETE CASCADE, name text NOT NULL, color text, icon text, sort_order int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`.
- `goals` — `(id uuid PK, user_id uuid NOT NULL → auth.users ON DELETE CASCADE, life_area_id uuid → life_areas ON DELETE SET NULL, title text NOT NULL, why_it_matters text, success_metrics text, status goal_status NOT NULL DEFAULT 'active', confidence goal_confidence NOT NULL DEFAULT 'medium', momentum goal_momentum NOT NULL DEFAULT 'stable', last_activity_at timestamptz, last_nudge_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`.
- `projects` — `(id uuid PK, user_id uuid NOT NULL → auth.users ON DELETE CASCADE, goal_id uuid → goals ON DELETE SET NULL, title text NOT NULL, description text, status task_status NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`.
- `daily_briefings` — `(id uuid PK, user_id uuid NOT NULL → auth.users ON DELETE CASCADE, briefing_date date NOT NULL, content jsonb NOT NULL, was_delivered boolean NOT NULL DEFAULT false, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, briefing_date))`.
- `tasks` table altered: `ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL`, `ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES goals(id) ON DELETE SET NULL`.

**Enums:** `goal_status`, `goal_confidence`, `goal_momentum` — created before table DDL.

**RLS pattern (identical to existing tables):**
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can manage own <table>"
  ON <table> FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
GRANT ALL ON TABLE <table> TO anon, authenticated, service_role;
```

**Migration naming:** `YYYYMMDDHHMMSS_add_goal_hierarchy.sql` — timestamp must be later than `20260620140813`.

### API

No new API routes in this wave. The existing `POST /api/chat` endpoint dispatches tool calls; the handlers registered in this wave become reachable through that route automatically.

### UI

No new UI in this wave. The Settings tool-permission toggles will display the six new tool names once `tool_permissions` rows are seeded.

### Testing

- **Unit:** handler functions tested in isolation with a mocked Supabase client; assert correct insert columns, filter logic in `list_goals`, and error-path returns.
- **Integration:** migration applied to a test Supabase instance; verify table existence, enum values, unique constraint on `daily_briefings(user_id, briefing_date)`, RLS blocking cross-user access.
- **Regression:** existing task tool tests (`create_task`, `list_tasks`) must continue to pass after `project_id`/`goal_id` columns are added to `tasks`.
- **Type check:** `npm run typecheck` is the acceptance gate; zero errors required.
- **Coverage target:** handler logic ≥ 80% line coverage.

### Deployment

No Vercel Cron changes in this wave. Migration is applied via `npx supabase db push` before deploying the updated `handlers.ts` and `registry.ts` to Vercel. TypeScript types must be regenerated after migration and committed.

### Monitoring

No new monitoring in this wave. Existing structured logging in `executeToolHandler` covers errors for the new handlers.

---

## Handoff Requirements

- Wave 4.2.1 (Goals UI) requires `life_areas` and `goals` to exist and be queryable by the authenticated user.
- Wave 4.3.1 (Momentum Job) requires `goals.momentum`, `goals.last_activity_at`, and `goals.last_nudge_at` columns.
- Wave 4.4.1 (Briefing) requires `daily_briefings` table with the unique constraint and `was_delivered` column.
- Epic 6 builds on the `goals` table's `why_it_matters` and `success_metrics` columns for pattern detection and weekly review.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Migration timestamp collision with a future Epic 2 migration | Low | Low | Assign timestamp at time of creation; do not pre-allocate |
| `projects.status` reuses `task_status` enum — semantics differ slightly | Low | Low | Accept reuse for now; add a `project_status` enum in Epic 6 if needed |
| `handleGenerateDailyBriefing` stub creates a misleading response | Low | Medium | Stub returns `{ status: 'scheduled' }` and logs that Feature 4.4 is pending; document in code |
| RLS policy gaps on `life_areas` (no `user_id` updates should be allowed) | Medium | Low | Test via integration test that UPDATE of `user_id` is rejected |

---

## Related Documentation

- Architecture §14.3: full column-level schema for goals tables.
- Business Requirements Feature 1: goal hierarchy acceptance criteria.
- Business Requirements UC-6 (create goal), UC-7 (link task).
- ADR-010: momentum is stored (not computed real-time); `goals.momentum` column is the storage target.
- Existing migration style: `supabase/migrations/20260620140813_add_task_reminders_table.sql`.
- Existing tool pattern: `apps/web/src/lib/chat/tools/registry.ts`, `handlers.ts`.
