---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "1"
feature: "1.1"
wave: "1.1.1"
agents: []
tags: [coriven, bug-fix, regression-tests, task-reminders, recurrence]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
---

# Wave 1.1.1: As-Built Bug Fixes — Verification & Regression Tests

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 1.1.1 |
| Feature | 1.1 — As-Built Bug Fixes |
| Epic | 1 — Foundation Closeout |
| Status | Planning |
| Scope | Verify the two known Phase-1 defects are resolved in the working tree; add regression tests to prevent regressions. No re-fixing required — both bugs are already patched. |
| Wave Goal | Confirm `/api/tasks/due` correctly queries `task_reminders` and `getNextOccurrence` is imported exclusively from `@personal-assistant/types`, then lock both behaviors with automated tests. |

**Wave Philosophy:** Scope-based — this wave closes when verification and regression coverage are done, not on a schedule.

## Wave Goals

1. Verify `/api/tasks/due` returns correct reminders from `task_reminders` (not the dropped `tasks.remind_at` column) in a reproducible integration test, satisfying Business Requirements Feature 2 acceptance criterion #1.
2. Confirm `apps/tray/src/db.ts` uses `getNextOccurrence` exclusively from `@personal-assistant/types` (zero local copies), satisfying Feature 2 acceptance criterion #2 and Architecture ADR-004.
3. Achieve >80% branch coverage on the recurrence logic in `packages/types` and meaningful integration coverage on the due-reminders API route, providing the regression safety net required before the Feature 1.2 production deploy.

## User Stories

---

### Story 1.1.1.1 — Due-Reminders API Returns Correct Data

**As the** tray daemon,  
**I want** `/api/tasks/due` to return only reminders from the `task_reminders` table,  
**So that** due reminders are never silently missed because of a query against a dropped column.

**Reference:** Business Requirements Feature 2; UC-2, UC-4.

**Priority:** Critical  
**Estimated hours:** 6

**Acceptance Criteria:**
- `/api/tasks/due` (GET) returns HTTP 200 with a JSON array drawn from `task_reminders`, not from any column on `tasks`.
- Reminders whose task status is `done` or `cancelled` are excluded from the response.
- Snoozed reminders (`snoozed_until` in the future) are excluded from the response.
- An unauthenticated request returns HTTP 401.
- Integration test coverage demonstrates all of the above behaviors pass in CI.

---

#### Task 1.1.1.1.1 — Integration Test: `/api/tasks/due` Query Correctness

| Field | Value |
|---|---|
| Parent Story | 1.1.1.1 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | None |
| Deliverables | `apps/web/src/app/api/tasks/due/__tests__/route.test.ts` (or equivalent Jest/Vitest integration spec) |

**Acceptance Criteria:**
- Tests seed `task_reminders` rows and assert the route returns them.
- Tests assert rows where the joined task is `done` or `cancelled` are excluded.
- Tests assert snoozed rows (future `snoozed_until`) are excluded.
- A test with no auth header asserts HTTP 401.
- All four cases pass in `npm test`.

---

### Story 1.1.1.2 — Single Source of Recurrence Truth

**As the** developer,  
**I want** `getNextOccurrence` to exist only in `packages/types` with no local duplicate in the tray,  
**So that** recurrence logic cannot silently diverge between the tray and the rest of the system.

**Reference:** Architecture ADR-004; Business Requirements Feature 2 acceptance criterion #2.

**Priority:** High  
**Estimated hours:** 4

**Acceptance Criteria:**
- A grep across `apps/tray/src/` finds no function named `getNextOccurrence` defined locally.
- `apps/tray/src/db.ts` imports `getNextOccurrence` from `@personal-assistant/types`.
- `npm run typecheck` passes with no errors across the monorepo.
- A unit test in `packages/types` covers all six `recurrence_type` values (`none`, `daily`, `weekdays`, `weekly`, `monthly`, `yearly`) and the `recurrence_end_at` boundary condition.

---

#### Task 1.1.1.2.1 — Static Verification: No Local `getNextOccurrence` in Tray

| Field | Value |
|---|---|
| Parent Story | 1.1.1.2 |
| Agent | backend-specialist |
| Estimation | 1h |
| Dependencies | None |
| Deliverables | CI lint/grep step (or documented manual verification) confirming no local copy |

**Acceptance Criteria:**
- A search of `apps/tray/src/` for a locally declared `getNextOccurrence` returns zero results.
- Verification is repeatable in CI (grep step or ESLint no-restricted-syntax rule).

---

#### Task 1.1.1.2.2 — Unit Tests: `getNextOccurrence` in `packages/types`

| Field | Value |
|---|---|
| Parent Story | 1.1.1.2 |
| Agent | backend-specialist |
| Estimation | 3h |
| Dependencies | Task 1.1.1.2.1 (confirm import is from shared package before writing tests against it) |
| Deliverables | `packages/types/src/__tests__/task.test.ts` with ≥80% branch coverage on `getNextOccurrence` |

**Acceptance Criteria:**
- All six recurrence types produce the correct next date.
- `recurrence_type = 'none'` returns `null`.
- A date past `recurrence_end_at` returns `null`.
- Weekend-skip behavior for `weekdays` is tested across a Friday → next Monday boundary.
- Coverage report shows ≥80% branches on the function.
- Tests pass in `npm test` across the monorepo.

---

### Story 1.1.1.3 — Typecheck and Lint Clean

**As the** developer,  
**I want** the full monorepo typecheck and lint to pass after all fixes and tests are in place,  
**So that** the codebase is in a verified state before deploying to production in Feature 1.2.

**Priority:** High  
**Estimated hours:** 2

**Acceptance Criteria:**
- `npm run typecheck` exits 0 with no TypeScript errors across all packages.
- `npm run lint` (if configured) exits 0 with no errors.
- No `any` casts introduced by the new test files beyond what already exists in the codebase.

---

#### Task 1.1.1.3.1 — Monorepo Typecheck Gate

| Field | Value |
|---|---|
| Parent Story | 1.1.1.3 |
| Agent | quality-control |
| Estimation | 2h |
| Dependencies | Task 1.1.1.1.1, Task 1.1.1.2.2 |
| Deliverables | CI log showing zero typecheck errors; any type errors found are fixed |

**Acceptance Criteria:**
- `npm run typecheck` exits 0.
- If type errors are found, they are resolved before this wave closes.

---

## Task Dependencies

```
Task 1.1.1.2.1 (verify no local copy)
    └── Task 1.1.1.2.2 (unit tests for shared fn)
            └── Task 1.1.1.3.1 (typecheck gate)

Task 1.1.1.1.1 (integration test for route)
    └── Task 1.1.1.3.1 (typecheck gate)
```

Tasks 1.1.1.1.1 and 1.1.1.2.1/2.2 can run in parallel. The typecheck gate is the final serial step.

**Critical path:** 1.1.1.2.1 → 1.1.1.2.2 → 1.1.1.3.1 (10h serial at most; parallel with 1.1.1.1.1).

## Definition of Done

- [ ] `npm run typecheck` exits 0 across the monorepo.
- [ ] `npm test` passes — integration test for `/api/tasks/due` and unit tests for `getNextOccurrence` all green.
- [ ] ≥80% branch coverage on `getNextOccurrence` in `packages/types`.
- [ ] No local definition of `getNextOccurrence` in `apps/tray/src/` (verified in CI or by grep).
- [ ] `apps/tray/src/db.ts` import of `getNextOccurrence` confirmed from `@personal-assistant/types`.
- [ ] All acceptance criteria in every user story are checked and passing.
- [ ] Wave is smoke-testable locally: run the tray, create a recurring reminder, observe it fires and advances correctly.

## Infrastructure Specifications

### API

**`GET /api/tasks/due`**

| Field | Value |
|---|---|
| Method | GET |
| Auth | Supabase SSR session (cookie); 401 if missing |
| Service client | `createServiceClient()` (service-role, bypasses RLS for server-side join) |
| Query | `task_reminders` JOIN `tasks(title, status)`, filtered to `user_id = auth.uid()`, `remind_at <= now + 24h`, `snoozed_until IS NULL OR snoozed_until <= now`, task status NOT IN `(done, cancelled)` |
| Response 200 | `Array<TaskReminder & { task: { title: string; status: string } }>` |
| Response 401 | `{ error: "Unauthorized" }` |
| Response 500 | `{ error: string }` |

No schema changes. No new env vars. No new endpoints.

### Testing

| Level | Approach | Coverage Target |
|---|---|---|
| Unit | `packages/types/src/__tests__/task.test.ts` — all recurrence branches | ≥80% branches on `getNextOccurrence` |
| Integration | `apps/web/src/app/api/tasks/due/__tests__/route.test.ts` — mock Supabase client; test auth gate, task-status filter, snooze filter | Meaningful statement coverage of the route handler |
| Static | Grep or ESLint rule asserting no local `getNextOccurrence` in `apps/tray/src/` | 100% (zero occurrences) |
| Manual smoke | Run tray locally; create reminder; verify it fires and recurs | Pass/fail |

**Test framework:** Vitest (preferred for the Next.js monorepo) or Jest, whichever is already configured. Use `@supabase/supabase-js` mock or Vitest module mocking for the integration spec.

## Handoff Requirements

Wave 1.2.1 (Production Deployment) requires:
- This wave's Definition of Done fully met — specifically, `/api/tasks/due` must be regression-tested before the route ships to production.
- `npm run typecheck` clean.
- No known defects remaining from Architecture Appendix D items 1 and 2.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Test framework not yet configured in monorepo | Medium | Medium | Add Vitest with minimal config; do not block on elaborate setup |
| Supabase client is hard to mock in route tests | Medium | Medium | Use dependency injection or module mocking; alternatively test against a local Supabase instance |
| `npm run typecheck` reveals pre-existing type errors | Low | Low | Fix or document; do not ship known errors |

## Related Documentation

- Epic: `docs/implementation/_main/epic-1-foundation-closeout.md`
- Architecture: `docs/architecture/_main/04-Architecture.md` (Appendix D, ADR-004, §"Data Architecture")
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` (Feature 2)
