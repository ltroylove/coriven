---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "7"
feature: "7.1"
wave: "7.1.1"
agents: []
tags: [coriven, proactive, pattern-detection, cron, detected-patterns, tray, notifications]
relateddocuments:
  - "docs/implementation/_main/epic-7-proactive-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 7.1.1: Pattern Detection

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.1.1 |
| Feature | 7.1 — Pattern Detection |
| Epic | 7 — Proactive Intelligence |
| Status | Planning |
| Scope | Create `detected_patterns` table with RLS; implement the nightly cron job that analyzes task-completion history for habits and blockers; expose results via the `detect_patterns` tool; fire a subtle tray notification when a new pattern is first detected |

**Wave Philosophy:** Scope-based — this wave is complete when the pattern-detection pipeline runs nightly, writes to `detected_patterns` with correct RLS, is surfaced to the chat via the `detect_patterns` tool, and a verified new detection fires a single tray notification — regardless of calendar time.

## Wave Goals

1. **Pattern store in place.** Deliver the `detected_patterns` table (blueprint §14.5) with `pattern_type`, `description`, `last_detected_at`, `is_active`, `user_id`, and timestamps; RLS enforced; migration cleanly applied — establishing the durable store that all proactive surfacing reads from.
2. **Nightly detection job operational.** Ship a `lib/jobs/detect-patterns.ts` job behind a `CRON_SECRET`-gated endpoint that analyzes task-completion history for at least four pattern types (`gym_days`, `weekly_review_time`, `stale_goal`, `follow_up_needed`) using conservative thresholds, writes new or updated rows, and is idempotent against double-firing.
3. **Chat and tray integration complete.** The `detect_patterns` tool (registry + handler) returns active patterns to the chat engine on demand; the tray polls the briefing endpoint and fires exactly one subtle notification per newly detected pattern, respecting a once-per-7-day frequency cap per pattern type.

## User Stories

### Story 7.1.1.1 — Pattern store exists with correct schema and RLS

**As the** system,
**I want** the `detected_patterns` table created with the fields defined in Architecture §14.5 and per-user RLS enforced,
**So that** every user's detected habits and blockers are isolated by owner and the detection job has a stable, queryable store.

**Acceptance Criteria:**
- `detected_patterns` exists with `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `pattern_type text NOT NULL`, `description text NOT NULL`, `last_detected_at timestamptz DEFAULT now()`, `is_active boolean DEFAULT true`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz`.
- RLS enabled; policy enforces `user_id = auth.uid()` for all operations.
- An index exists on `(user_id, pattern_type, is_active)` to support efficient per-user active-pattern queries.
- Migration applied cleanly via `npx supabase db push`; rollback is safe.
- TypeScript types regenerated and committed to `apps/web/src/types/supabase.ts`.
- No row can be inserted without a `user_id`; `ON DELETE CASCADE` verified.

**Priority:** Critical (blocks all other stories in this wave)
**Estimated hours:** 4h

#### Task 7.1.1.1.1 — Create `detected_patterns` migration

- **Parent Story:** 7.1.1.1
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Epic 4 goals/tasks tables must exist (migration prerequisite)
- **Deliverables:** `supabase/migrations/<timestamp>_create_detected_patterns.sql`; regenerated `apps/web/src/types/supabase.ts`
- **Acceptance Criteria:** Migration is idempotent; `pgx` rollback tested; all columns, index, and RLS policy present as specified; TypeScript types reflect the new table; service-role client can insert rows; anon client insert is rejected by RLS.

---

### Story 7.1.1.2 — Nightly pattern detection job runs and writes results

**As the** Pattern-Detection Cron actor,
**I want** to analyze each user's task-completion history nightly and write detected habits and recurring blockers to `detected_patterns`,
**So that** the system accumulates an accurate behavioral signal without fabricating data in cold-start conditions.

**Acceptance Criteria:**
- A Vercel Cron job fires nightly (configurable schedule via `vercel.json`); the endpoint is `POST /api/cron/detect-patterns`; it validates the `Authorization: Bearer <CRON_SECRET>` header and returns HTTP 401 on mismatch.
- The job iterates all active users and runs pattern analysis per user.
- At minimum four pattern types are analyzed: `gym_days` (recurring task completions on specific weekdays), `weekly_review_time` (consistent review behavior), `stale_goal` (delegated to the momentum model from Epic 4), `follow_up_needed` (tasks with no activity for configurable thresholds).
- Conservative thresholds: a pattern is only written when evidence is statistically clear (e.g., gym pattern requires at least 3 occurrences on the same weekday within the past 4 weeks); cold-start users with insufficient history receive no fabricated patterns.
- A newly detected pattern (first occurrence) sets `is_active = true` and `last_detected_at = now()`. A pattern already present is updated in-place (`last_detected_at`, `description`) rather than duplicated — the job is idempotent.
- Stale patterns (not re-confirmed for 14 days) are set to `is_active = false`.
- The job logs a structured summary per user (patterns found, patterns deactivated); errors per user are logged and skipped without aborting the rest.
- Job runtime is measurable in monitoring; double-firing the job produces identical state.

**Priority:** High
**Estimated hours:** 8h
**Business Requirements:** Feature 8 (Proactive Intelligence), UC-42 (Pattern detection nightly)

#### Task 7.1.1.2.1 — Implement pattern-analysis library

- **Parent Story:** 7.1.1.2
- **Agent:** Backend Engineer
- **Estimation:** 6h
- **Dependencies:** Task 7.1.1.1.1 (table exists); Epic 4 `goals` and `tasks` tables with `completed_at`
- **Deliverables:** `apps/web/src/lib/jobs/detect-patterns.ts` — exported `runPatternDetection(userId: string): Promise<PatternDetectionResult>` function; type definitions in `@personal-assistant/types`
- **Acceptance Criteria:** Function is pure-ish (takes userId, queries DB, writes patterns); all four pattern types implemented; cold-start guard (insufficient history → no write); idempotent upsert; structured return value with counts; no hardcoded thresholds — values sourced from named constants exported from the module.

#### Task 7.1.1.2.2 — Implement cron endpoint and Vercel Cron config

- **Parent Story:** 7.1.1.2
- **Agent:** Backend Engineer
- **Estimation:** 2h
- **Dependencies:** Task 7.1.1.2.1
- **Deliverables:** `apps/web/src/app/api/cron/detect-patterns/route.ts`; updated `vercel.json` with cron schedule; updated `.env.example` confirming `CRON_SECRET` entry
- **Acceptance Criteria:** `POST /api/cron/detect-patterns` validates `CRON_SECRET` from env (not hardcoded); returns HTTP 200 with a job summary JSON on success; returns HTTP 401 on invalid secret; returns HTTP 500 with a logged error if the job fails; Vercel Cron schedule entry present in `vercel.json`.

---

### Story 7.1.1.3 — `detect_patterns` tool surfaces results to chat

**As the** Primary User,
**I want** to ask Coriven what patterns it has detected about my habits,
**So that** I can understand my behavioral signals and act on them conversationally.

**Acceptance Criteria:**
- A `detect_patterns` tool is registered in `TOOL_REGISTRY` with a JSON-Schema input (optional `pattern_type` filter, optional `is_active` filter defaulting to `true`).
- A handler in `handlers.ts` queries `detected_patterns` for the authenticated user, respects the filters, and returns a structured list of patterns.
- The tool is added to `ALL_TOOL_NAMES` and must appear in `tool_permissions` for the user to enable it.
- When a user asks "what patterns have you detected?", the chat engine calls the tool and returns a readable summary — without fabricating patterns not in the database.
- Disabled tool behavior follows existing engine contract: if `detect_patterns` is not enabled in `tool_permissions`, it is not offered to the model.

**Priority:** High
**Estimated hours:** 4h
**Business Requirements:** Feature 8 (Proactive Intelligence), UC-42

#### Task 7.1.1.3.1 — Add `detect_patterns` to tool registry and handler

- **Parent Story:** 7.1.1.3
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Task 7.1.1.1.1 (table); existing `registry.ts` and `handlers.ts` patterns
- **Deliverables:** Updated `apps/web/src/lib/chat/tools/registry.ts`; updated `apps/web/src/lib/chat/tools/handlers.ts`; updated `ToolName` type in `@personal-assistant/types`
- **Acceptance Criteria:** Tool appears in registry with valid JSON Schema; handler queries only the authenticated user's rows (RLS enforced at DB layer, `user_id` filter added defensively in handler); handler returns `is_error: false` with serialized patterns array or empty array; handler returns `is_error: true` with a clear message on DB error; `ToolName` union type updated; `tool_permissions` seed or migration inserts a default row for `detect_patterns` for existing users.

---

### Story 7.1.1.4 — Tray delivers a subtle notification on new pattern detection

**As the** Primary User,
**I want** to receive a single subtle tray notification when Coriven detects a new habit for the first time,
**So that** I'm informed proactively without being nagged by repeated or excessive alerts.

**Acceptance Criteria:**
- The tray polls a `/api/patterns/new` endpoint (or equivalent field on an existing poll response) that returns patterns detected since the last poll acknowledgment.
- Each new pattern fires exactly one native notification with a calm, informational message (e.g., "Coriven noticed you tend to go to the gym on Tuesdays and Thursdays").
- Frequency cap: a given `pattern_type` does not fire another notification for the same user within 7 days of the last notification for that type, regardless of how many times the job runs.
- The cap is enforced server-side (a `last_notified_at` field or a lightweight `pattern_notifications` record) so it persists across tray restarts.
- No sound for pattern notifications (informational only, per calm-proactivity principle from UX §4.1).
- The notification body is ≤ 100 characters to fit native OS constraints.
- Tray behavior is identical whether running as the Node.js daemon (current) or the future Tauri shell — logic lives in the API endpoint, not in the tray client.

**Priority:** Medium
**Estimated hours:** 6h
**Business Requirements:** Feature 8, UC-42; UX calm-proactivity principle

#### Task 7.1.1.4.1 — Implement `/api/patterns/new` endpoint with frequency cap

- **Parent Story:** 7.1.1.4
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Task 7.1.1.1.1 (table); Task 7.1.1.2.1 (job writes patterns)
- **Deliverables:** `apps/web/src/app/api/patterns/new/route.ts`; updated `detected_patterns` table or a lightweight frequency-cap mechanism (column `last_notified_at timestamptz` on `detected_patterns`)
- **Acceptance Criteria:** `GET /api/patterns/new` is authenticated (Supabase SSR session); returns patterns where `is_active = true` and `last_notified_at` is null or older than 7 days; a `POST /api/patterns/[id]/acknowledge` marks `last_notified_at = now()`; both endpoints enforce RLS so a user can only read/update their own patterns; the 7-day window is sourced from a named constant, not a magic number.

#### Task 7.1.1.4.2 — Integrate new-pattern check into tray poll loop

- **Parent Story:** 7.1.1.4
- **Agent:** Backend / Tray Engineer
- **Estimation:** 2h
- **Dependencies:** Task 7.1.1.4.1
- **Deliverables:** Updated `apps/tray/src/index.ts` (or Tauri equivalent) to poll `/api/patterns/new` on the existing poll cycle; updated `apps/tray/src/notifier.ts` (or equivalent) with a `notifyPattern` function
- **Acceptance Criteria:** Tray calls `/api/patterns/new` on each poll cycle; for each returned pattern, fires one notification (no sound, ≤ 100 chars) and calls the acknowledge endpoint; no infinite re-notification loop; errors during pattern poll are logged but do not crash the reminder poll.

---

## Task Dependencies

```
7.1.1.1.1  (migration)
    └─► 7.1.1.2.1  (analysis library)
           └─► 7.1.1.2.2  (cron endpoint)
    └─► 7.1.1.3.1  (tool registry + handler)
    └─► 7.1.1.4.1  (new-pattern endpoint + freq cap)
           └─► 7.1.1.4.2  (tray integration)
```

**Critical path:** Migration → analysis library → cron endpoint. Tool and tray tasks can parallelize once the migration is done.

## Definition of Done

- `detected_patterns` table is deployed to the production Supabase project with RLS verified.
- Nightly cron (`/api/cron/detect-patterns`) is registered in `vercel.json`, gated by `CRON_SECRET`, and has run successfully at least once in a non-production environment producing valid rows.
- Cold-start condition verified: a user with fewer than 3 task completions receives zero fabricated patterns.
- `detect_patterns` tool is enabled by default in `tool_permissions`; chat returns pattern data on a direct query.
- Tray fires exactly one notification per new pattern per pattern type per 7 days, verified in a manual end-to-end test.
- Unit tests cover: pattern-analysis logic (gym_days, stale_goal, follow_up_needed thresholds), idempotent upsert, frequency-cap enforcement, tool handler (empty case, populated case, DB error).
- Integration test verifies: cron endpoint returns HTTP 401 on missing/wrong secret; HTTP 200 with valid secret.
- `CRON_SECRET` is documented in `.env.example`; not hardcoded anywhere in source.
- TypeScript strict-mode passes with no new errors (`npm run typecheck`).

## Infrastructure Specifications

### Database

**Table:** `detected_patterns`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `user_id` | `uuid NOT NULL` | FK → `auth.users(id) ON DELETE CASCADE` | RLS anchor |
| `pattern_type` | `text NOT NULL` | | `gym_days`, `weekly_review_time`, `stale_goal`, `follow_up_needed` |
| `description` | `text NOT NULL` | | Human-readable; used in tray notification body |
| `last_detected_at` | `timestamptz` | DEFAULT `now()` | Updated each time the pattern is re-confirmed |
| `last_notified_at` | `timestamptz` | nullable | Frequency-cap anchor; null = never notified |
| `is_active` | `boolean` | DEFAULT `true` | Set false when pattern not re-confirmed for 14 days |
| `created_at` | `timestamptz` | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | DEFAULT `now()` | Trigger or application-managed |

**RLS policies:** `SELECT/INSERT/UPDATE/DELETE` gated by `user_id = auth.uid()`. Service-role client used for cron writes.

**Index:** `CREATE INDEX ON detected_patterns (user_id, pattern_type, is_active);`

**Migration name:** `<timestamp>_create_detected_patterns`

### API

**Cron endpoint:**

| Attribute | Value |
|---|---|
| Method | `POST` |
| Path | `/api/cron/detect-patterns` |
| Auth | `Authorization: Bearer ${CRON_SECRET}` header; HTTP 401 on mismatch |
| Request body | none |
| Response 200 | `{ usersProcessed: number, patternsWritten: number, patternsDeactivated: number }` |
| Response 401 | `{ error: "Unauthorized" }` |
| Response 500 | `{ error: string }` |
| Idempotency | Safe to call multiple times; produces identical state |
| Error handling | Per-user errors logged with `user_id`; job continues to next user |

**New-pattern endpoint:**

| Attribute | Value |
|---|---|
| Method | `GET` |
| Path | `/api/patterns/new` |
| Auth | Supabase SSR session cookie |
| Response 200 | `{ patterns: Array<{ id, pattern_type, description, last_detected_at }> }` |
| Frequency cap | 7-day window per `pattern_type` per user, enforced via `last_notified_at` |

**Acknowledge endpoint:**

| Attribute | Value |
|---|---|
| Method | `POST` |
| Path | `/api/patterns/[id]/acknowledge` |
| Auth | Supabase SSR session; RLS enforced |
| Response 200 | `{ acknowledged: true }` |
| Response 404 | pattern not found or not owned by user |

**Tool handler — `detect_patterns`:**

| Attribute | Value |
|---|---|
| Input schema | `{ pattern_type?: string, is_active?: boolean }` |
| Returns | Serialized array of `detected_patterns` rows matching filters |
| Auth | `userId` from chat engine session; service-role client with `user_id` filter |
| Errors | `is_error: true` with message on DB failure |

### Testing

- **Unit:** Pattern-analysis logic for each of the four pattern types; cold-start guard; idempotent upsert (write once vs. write twice produces same DB state); frequency-cap logic (last_notified_at < 7 days → excluded; null → included).
- **Integration:** Cron endpoint HTTP 401 on bad secret; HTTP 200 on valid secret; endpoint calls analysis function; patterns land in DB.
- **Tool handler:** Returns empty array when no patterns exist; returns populated array when patterns exist; returns error result on simulated DB failure.
- **Frequency-cap test:** Pattern notified today → not returned by `/api/patterns/new`; pattern notified 8 days ago → returned.
- **Coverage target:** 80% line coverage on `lib/jobs/detect-patterns.ts` and the tool handler.

### Deployment

- **Vercel Cron entry in `vercel.json`:**
  ```json
  { "path": "/api/cron/detect-patterns", "schedule": "0 3 * * *" }
  ```
  (3am UTC nightly; adjust for user timezone distribution if needed in a future wave)
- **Environment variables required:** `CRON_SECRET` (already documented in Architecture Appendix C)
- **Migration:** Applied via `npx supabase db push` before cron is activated

### Monitoring

- **Detection rate:** Number of new patterns written per nightly run; alert on zero for more than 7 consecutive runs on an active user.
- **False positives:** No direct signal initially; reviewed manually by the owner weekly.
- **Nudge frequency:** Count of notifications fired per user per week; alert if any user receives more than one notification per pattern type per week (frequency-cap breach).
- **Cron health:** Vercel dashboard shows last execution status; alert on HTTP 5xx.

## Handoff Requirements

- Epic 4 (goals/tasks) must be deployed and `goals`, `tasks`, `task_reminders` tables populated with real usage data before pattern detection produces meaningful output.
- `CRON_SECRET` must be set in the Vercel production environment before the cron activates.
- The `detect_patterns` tool must be seeded into `tool_permissions` for existing users, or the permissions page updated to show the new tool.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Insufficient behavioral data on first run (cold start) | Med | High (early weeks) | Conservative thresholds; cold-start guard writes nothing rather than fabricating; patterns improve with use |
| Cron double-fires (Vercel retry) | Low | Low | Idempotent upsert on `(user_id, pattern_type)`; `last_detected_at` update is idempotent |
| False pattern signals (noisy detection) | Low | Med | Conservative thresholds require multiple confirmations; `is_active` allows decay; user can dismiss via chat |
| Tray notification spam if frequency cap missed | Med | Low | Cap enforced server-side (survives tray restarts); unit-tested |
| Epic 4 not deployed at time of wave start | High | Med | Wave is blocked on Epic 4; document as a prerequisite blocker |

## Related Documentation

- Epic: `docs/implementation/_main/epic-7-proactive-intelligence.md` — Feature 7.1
- Architecture: `docs/architecture/_main/04-Architecture.md` — §14.5 (`detected_patterns`), jobs/cron
- ADR-010: `docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md`
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` — Feature 8, UC-42
- UX: `docs/architecture/_main/05-User-Experience.md` — calm proactivity principle
- Blueprint: `docs/planning/2026-06-24-coriven-master-blueprint.md` — §12.1, §14.5
