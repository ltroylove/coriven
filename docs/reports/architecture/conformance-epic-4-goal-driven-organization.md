# Architecture Conformance Review — Epic 4: Goal-Driven Organization

**Reviewer**: system-architect agent
**Date**: 2026-07-02
**Branch reviewed**: `epic/4-goal-driven-organization` (Waves 4.1.1 – 4.4.2)
**Scope**: ADR-008, ADR-010, and the architecture invariants in `docs/architecture/_main/04-Architecture.md`
**Nature**: Advisory, not blocking.

---

## Verdicts

| ADR | Verdict | Summary |
|---|---|---|
| **ADR-008** (Deterministic daily briefing, no LLM) | **COMPLIANT** | `assembleBriefing()` in `apps/web/src/lib/jobs/briefing.ts` makes zero model calls — only Supabase queries. No Anthropic/OpenAI import exists anywhere in `lib/jobs/`. The on-demand `generate_daily_briefing` chat tool reuses the same deterministic function. |
| **ADR-010** (Scheduled proactive jobs, no request-path computation) | **PARTIALLY COMPLIANT** | The *design* conforms: momentum computation lives exclusively in `lib/jobs/momentum.ts` and is invoked only from `/api/cron/nightly` (verified by grep — `computeMomentum`/`recomputeMomentum` appear nowhere in the request path). However, two operational defects (C-1, C-2) mean the nightly recompute will not actually run reliably in production, defeating the ADR's guarantee. |

---

## Critical findings

### C-1: Cron routes export only `POST`, but Vercel Cron invokes via HTTP `GET` — both jobs will never fire in production

- `apps/web/src/app/api/cron/nightly/route.ts:19` — `export async function POST(...)` only.
- `apps/web/src/app/api/cron/daily-briefing/route.ts:21` — `export async function POST(...)` only.
- `vercel.json:8-11` registers both paths as crons.

Vercel documentation (verified 2026-07-02): *"To trigger a cron job, Vercel makes an HTTP GET request to your project's production deployment URL."* A POST-only App Router route returns **405 Method Not Allowed** to a GET. Consequence: momentum is never recomputed, nudges never fire, and briefings are never generated — silently. This breaks ADR-010's core decision ("Momentum is recalculated nightly") and ADR-008's delivery path in practice.

**Recommendation**: Export a `GET` handler in both routes (it can delegate to the existing logic). Keep the `CRON_SECRET` Bearer check — Vercel attaches `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set. Optionally keep `POST` for manual triggering.

### C-2: Nightly idempotency guard is unsound — user activity silently skips the entire momentum job

`apps/web/src/app/api/cron/nightly/route.ts:27-44`: the guard skips the whole run if **any** row in `goals` — across **all users** — has `updated_at >= 00:00 UTC today`. But `updated_at` is set by the `update_goals_updated_at` trigger on *every* update, including user edits via `/goals` Server Actions (`apps/web/src/app/actions/goals.ts`) and the `update_goal` / `set_goal_momentum` chat tools.

The cron fires at 12:00 UTC. Any user who edits any goal between 00:00 and 12:00 UTC (6pm–6am US Central — normal evening usage) causes the nightly momentum recompute and stale-goal nudge detection to be skipped **for every user**. This violates ADR-010's "recalculated nightly" guarantee and introduces cross-user coupling.

**Recommendation**: Drop the `updated_at` heuristic. ADR-010's stated mitigation is the right pattern: idempotency via dedicated markers (`last_fired_at` on a job-runs table, unique constraints, `was_delivered`) — as the briefing job already does correctly with `UNIQUE (user_id, briefing_date)` + `ignoreDuplicates`. The momentum job is naturally idempotent anyway (recomputing twice yields the same value); a guard may not be needed at all.

---

## Warnings (advisory)

### W-1: `briefing_date` written in user timezone but read in UTC — users east of UTC see no briefing for hours

- Write: `/api/cron/daily-briefing/route.ts:65` uses `getTodayInTimezone(timezone)` (user-local date).
- Read: `/api/briefing/today/route.ts:22` and `apps/web/src/app/(app)/today/page.tsx:12` both compute `new Date().toISOString().slice(0, 10)` (UTC date).

For a user in e.g. Asia/Tokyo (UTC+9), the 7:00am local briefing is generated at 22:00 UTC the *previous* day with `briefing_date` = local day D; the read path asks for UTC day D-1... then D only after 09:00 local. The user's `/today` page and the tray's `/api/briefing/today` poll return empty/404 during exactly the morning window the briefing targets. Works by accident for US timezones (the current sole user), so not blocking — but it will bite productization.

**Recommendation**: Resolve "today" on the read path using the user's `profiles.timezone` (the same `getTodayInTimezone` helper), or fall back to "latest briefing".

### W-2: `set_goal_momentum` chat tool lets the model overwrite a job-computed signal in the request path

`apps/web/src/lib/chat/tools/registry.ts:335-350` and `handlers.ts:313-329`. ADR-010 (and blueprint §7.3) treat momentum as a signal *computed nightly from task activity*. This tool allows Claude to set it directly during chat; the nightly job then silently clobbers the value on its next run (`recomputeMomentum` updates unconditionally). This is not a literal violation — no *computation* happens on the request path — but it creates two sources of truth for one field and a confusing UX (user tells the assistant momentum is "declining"; it reverts overnight).

**Recommendation**: Either remove the tool, or explicitly document it as a temporary manual override (e.g. a `momentum_override` flag the job respects). If kept, record the decision in ADR-010.

### W-3: Stale tool description shipped to the model

`registry.ts:373-374` — `generate_daily_briefing` description still says "Full implementation is pending Feature 4.4", which is now complete. Tool descriptions are model-facing prompt content; a stale one degrades tool selection.

---

## Info

- **I-1**: `BriefingContent.goalsInMotion[].linkedTaskCount` (`lib/jobs/briefing.ts:8,39-51`) is populated from `projects(count)` — it is a **project** count, not a task count. Misnamed field surfaces in the `/today` UI contract.
- **I-2**: `apps/web/src/app/(app)/settings/page.tsx:24-36` (`getBriefingSettings`, added in Wave 4.4.1) uses `createServiceClient()` for a user-facing read. The page authenticates first and filters by `user.id`, and this matches the pre-existing `getToolPermissions` pattern in the same file, so it is consistent — but the auth-server client would add RLS defense-in-depth for zero cost. Advisory only.
- **I-3**: `briefing.ts:114-128` queries `approval_queue` with an `as never` cast and swallows errors (table lands in Epic 5). Acceptable forward-compatibility; revisit when the table exists so real errors are not silently mapped to 0.
- **I-4**: The `*/30 * * * *` briefing cron with a ±30-minute window means a user's slot is hit by two consecutive runs; the `UNIQUE (user_id, briefing_date)` + `ignoreDuplicates: true` upsert makes this correctly idempotent. Good — this is exactly the ADR-010 mitigation pattern.

---

## Pattern conformance (04-Architecture.md)

| Invariant | Status | Evidence |
|---|---|---|
| Service client only in cron/job/system contexts | **Pass** (with I-2 caveat) | `lib/jobs/momentum.ts:51,149`, `lib/jobs/briefing.ts:22`, both cron routes. Tool handlers use service client with explicit `user_id` filters — the established pre-Epic-4 pattern (`handlers.ts` throughout). |
| Auth-server client for user-facing reads | **Pass** | `/goals`, `/goals/[id]`, `/projects/[id]`, `/today` pages, `/api/briefing/today`, and all Server Actions in `app/actions/goals.ts` use `createAuthServerClient()` with `user_id` scoping. |
| `lib/jobs/` as the location for scheduled work | **Pass** | Matches 04-Architecture "Cron Jobs (`apps/web/src/lib/jobs/` + `/api/cron/*`)"; thin routes delegate to lib functions; pure functions (`computeMomentum`, `isStale`, `shouldNudge`) are unit-tested (`lib/jobs/__tests__/momentum.test.ts`). |
| Tool handler pattern | **Pass** | Six goal tools follow the one-handler-per-tool, `HandlerResult`, JSON-Schema-input, `user_id`-scoped pattern; registered in `HANDLERS` and seeded into `tool_permissions` (`supabase/migrations/20260702000000_add_goal_hierarchy.sql:197-208`). |
| `CRON_SECRET` gating | **Pass** | Both cron routes check a Bearer token with `timingSafeEqual` before any DB access. |
| RLS + `user_id` on all tables | **Pass** | All four new tables (`life_areas`, `goals`, `projects`, `daily_briefings`) have `user_id ... REFERENCES auth.users(id) ON DELETE CASCADE` and `USING (user_id = auth.uid())` policies. |
| Structured logging in jobs | **Pass** | JSON event logs in both jobs and both cron routes. |

---

## Summary

The Epic 4 design is faithful to ADR-008 and ADR-010: briefing assembly is genuinely LLM-free, and momentum computation lives only in scheduled jobs. The two Critical findings are operational, not architectural — a GET/POST mismatch that prevents Vercel Cron from invoking either job, and an idempotency heuristic that silently cancels the nightly run under normal user activity. Both are small fixes but must land before the ADRs' guarantees hold in production. All findings are advisory.
