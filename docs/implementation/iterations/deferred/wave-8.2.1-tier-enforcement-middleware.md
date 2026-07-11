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
feature: "8.2"
wave: "8.2.1"
agents: []
tags: [coriven, enforcement, middleware, entity-cap, reminder-cap, memory-window, tiers, paywall]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md"
---

# Wave 8.2.1: Tier Enforcement Middleware

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.2.1 |
| Feature | 7.2 — Tier Enforcement Middleware |
| Epic | 7 — Productization |
| Status | Planning |
| Scope | Enforce Free-tier caps (entity: 10, reminder: 1/day, memory window: 24h) and page-access rules at the middleware and tool-handler layer; centralize the memory-window age filter so both the Sentinel and inline assembly honor it without duplication. |
| Wave Goal | Free users are transparently capped without data loss; Core and Pro users access their full entitlements; the memory window degrades gracefully at retrieval rather than deleting data or producing errors. |

**Wave Philosophy:** Scope-based — this wave closes when all three cap types are enforced, tested, and observable; enforcement is additive to existing code paths, never destructive to stored data.

## Wave Goals

1. Entity and reminder caps are enforced before tool execution via a centralized `checkTierCap` guard that reads `subscription_tier` from `profiles` — satisfying Business Requirements UC-22 and UC-23 without duplicating tier logic across handlers.
2. The memory-window age filter is centralized in a single retrieval utility (`getMemoryWindowHours`) so the Sentinel package assembly and any inline memory assembly path both honor the Free/Core/Pro window (24h/168h/720h) per ADR-011 — old memories degrade gracefully, never throw errors.
3. Page-access enforcement is added to `middleware.ts` for any pages gated above Free (billing portal, advanced settings) — tier is resolved once per request from `profiles` and attached as a request header for downstream consumption.

## User Stories

---

### Story 7.2.1.1 — Entity Cap Enforcement Before Tool Execution

**As the** Coriven chat engine,
**I want** entity-creation tool calls to be blocked when a Free user already has 10 entities,
**So that** the entity cap is the load-bearing paywall and the upgrade prompt fires at the value moment.

**Reference:** Business Requirements Feature 9, UC-22; Vision §Pricing Strategy; ADR-011.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- When a Free user's `entity_profiles` count reaches 10 and a tool call would create an 11th entity, the tool handler returns a structured cap-hit response (not a generic error) with `reason: 'entity_cap'`.
- Core and Pro users have no entity cap; the guard is a no-op for those tiers.
- The cap check reads the current count from `entity_profiles` with a `COUNT(*)` query — not from a cached value — to prevent race conditions.
- Changing a user's `subscription_tier` from `free` to `core` immediately lifts the cap on the next tool call (no restart required).
- Unit tests confirm cap at exactly 10, no cap at 9, and no cap for Core/Pro regardless of count.

---

#### Task 7.2.1.1.1 — Central Tier Cap Guard

| Field | Value |
|---|---|
| Parent Story | 7.2.1.1 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Wave 8.1.1 (subscription_tier column, TIER_LIMITS constant) |
| Deliverables | `apps/web/src/lib/billing/cap-guard.ts` — exported `checkEntityCap(userId, supabase)`, `checkReminderCap(userId, supabase)` returning `{ allowed: boolean; reason?: string }` |

**Acceptance Criteria:**
- `checkEntityCap` queries `entity_profiles` COUNT for the user and compares to `TIER_LIMITS[tier].entityCap` (Infinity for Core/Pro).
- `checkReminderCap` queries `task_reminders` created today for the user and compares to `TIER_LIMITS[tier].reminderDailyLimit` (Infinity for Pro).
- Both functions accept an already-resolved `tier` parameter (caller looks up tier once and passes it in; no repeated profile fetches per tool call).
- Unit tests: entity cap at 10 for Free, no cap at 9, no cap for Core; reminder cap at 1 for Free, 3 for Core, no cap for Pro.
- Error handling: DB query failure returns `{ allowed: false, reason: 'cap_check_error' }` and logs; it does not silently allow the action.

---

#### Task 7.2.1.1.2 — Integrate Cap Guard into Entity-Creation Tool Handler

| Field | Value |
|---|---|
| Parent Story | 7.2.1.1 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.2.1.1.1; Epic 2 (entity_profiles table exists) |
| Deliverables | Modified entity-creation tool handler; integration test |

**Acceptance Criteria:**
- Entity-creation tool handler calls `checkEntityCap` before performing the insert.
- On `allowed: false`, the handler returns a structured tool result that the chat engine surfaces to the model with the cap reason (so the model can relay the upgrade prompt to the user).
- On `allowed: true`, the existing creation flow proceeds unchanged.
- Integration test seeds 10 entity_profiles for a Free user, asserts the 11th create is blocked; seeds 10 for a Core user, asserts it succeeds.
- No change to the tool's JSON schema or tool name — enforcement is internal to the handler.

---

### Story 7.2.1.2 — Daily Reminder Cap Enforcement

**As a** Free-tier user,
**I want** to see a clear explanation when I've hit my 1-reminder-per-day limit,
**So that** I understand why no additional reminder was created rather than experiencing a silent failure.

**Reference:** Business Requirements Feature 9, UC-23; Vision §Pricing Strategy.

**Priority:** High
**Estimated hours:** 6

**Acceptance Criteria:**
- The reminder-creation tool handler calls `checkReminderCap` before inserting into `task_reminders`.
- On cap hit, the handler returns `reason: 'reminder_cap'` with a message the model can relay to the user.
- Core users are capped at 3 reminders per calendar day (UTC-anchored or user-timezone-anchored — implementation decision noted for engineering; UTC acceptable at launch).
- Pro users have no reminder cap.
- Unit and integration tests confirm all three tier behaviors.

---

#### Task 7.2.1.2.1 — Integrate Cap Guard into Reminder-Creation Tool Handler

| Field | Value |
|---|---|
| Parent Story | 7.2.1.2 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.2.1.1.1 |
| Deliverables | Modified reminder-creation tool handler; unit/integration tests |

**Acceptance Criteria:**
- Reminder cap query counts `task_reminders` rows for the user where `created_at >= start of current UTC day`.
- On cap: structured cap-hit tool result; no `task_reminders` row inserted.
- On allowed: existing create flow unchanged.
- Integration test: Free user at 1 reminder today → second blocked; Core at 3 → fourth blocked; Pro at 10 → allowed.

---

### Story 7.2.1.3 — Memory Window Enforced at Retrieval (ADR-011)

**As the** chat engine and Sentinel,
**I want** memory retrieval to filter by the user's tier-appropriate age window,
**So that** older memories degrade gracefully (stop surfacing) rather than causing errors or being deleted — and upgrading instantly restores them.

**Reference:** Business Requirements Feature 9, UC-24; ADR-011; Architecture §Data Governance Rules.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- A single utility `getMemoryWindowCutoff(tier)` returns a `Date` representing the oldest memory timestamp that should be returned for the given tier (now minus 24h / 7d / 30d).
- All memory retrieval paths — both the Sentinel package assembly and any inline memory assembly — import and apply this cutoff as a `WHERE created_at >= cutoff` clause before returning memories.
- Memories older than the cutoff remain in the database; they are never deleted by tier enforcement.
- Upgrading from Free to Core: the next memory retrieval immediately returns memories up to 7 days old without any migration or re-fetch.
- A memory-window integration test verifies that a memory created 48 hours ago is excluded for a Free user and included for a Core user.
- Enforcement does not affect entity profiles (always in context; no window applied).

---

#### Task 7.2.1.3.1 — Centralized Memory Window Utility

| Field | Value |
|---|---|
| Parent Story | 7.2.1.3 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Wave 8.1.1 (TIER_LIMITS constant) |
| Deliverables | `apps/web/src/lib/billing/memory-window.ts` — exported `getMemoryWindowCutoff(tier: SubscriptionTier): Date` |

**Acceptance Criteria:**
- Returns `new Date(Date.now() - TIER_LIMITS[tier].memoryWindowMs)` — no hardcoded hours; reads from `TIER_LIMITS`.
- Unit tests cover all three tiers; the Free cutoff is exactly 24h ago (within 1ms); upgrading the tier parameter changes the output.
- The utility is the single import for memory-window logic across the codebase — verified by a grep confirming no other file calculates a memory age cutoff independently.

---

#### Task 7.2.1.3.2 — Apply Window Filter to Sentinel and Inline Memory Retrieval

| Field | Value |
|---|---|
| Parent Story | 7.2.1.3 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.2.1.3.1; Epic 2 (memory retrieval paths exist) |
| Deliverables | Modified `apps/web/src/lib/memory/retrieval.ts` (or equivalent); integration tests |

**Acceptance Criteria:**
- Both retrieval paths call `getMemoryWindowCutoff(tier)` and pass the cutoff as a filter parameter to the Supabase query.
- The `match_memories` RPC (pgvector cosine search) is updated to accept an optional `created_after` parameter so the filter is applied at the DB level, not in-process.
- Integration test: insert memories at t-48h and t-1h for a Free user; retrieval returns only the t-1h memory; upgrading tier to Core returns both.
- Sentinel package assembly uses the same utility (verified by reading the Sentinel build code, not assumed).
- No memory rows are deleted during this wave or as a result of any tier check.

---

### Story 7.2.1.4 — Middleware Page-Access Enforcement

**As the** middleware layer,
**I want** to resolve a user's subscription tier once per request and enforce page-gating rules,
**So that** pages above the Free tier (e.g., advanced settings, future Pro-only features) redirect to the pricing page rather than rendering inaccessible content.

**Reference:** Business Requirements Feature 9; Architecture §Authentication and Authorization.

**Priority:** High
**Estimated hours:** 6

**Acceptance Criteria:**
- `middleware.ts` is extended to attach `x-user-tier` as a request header after the session is confirmed (so API routes and server components can read tier without an additional DB query).
- A configurable `TIER_REQUIRED_ROUTES` map specifies minimum tier per route prefix; routes not in the map are free to access.
- A user accessing a route above their tier is redirected to `/pricing?reason=tier`.
- The tier header is set to `'free'` for unauthenticated users on routes that do not require auth (e.g., public landing page); authenticated users always get their real tier.
- Middleware adds no more than ~50ms latency (profile fetch is a single indexed lookup by `id`).
- Integration tests confirm: Free user redirected from a Pro-only page; Core user allowed to a Core page; tier header present on all authenticated requests.

---

#### Task 7.2.1.4.1 — Extend Middleware with Tier Resolution and Route Gating

| Field | Value |
|---|---|
| Parent Story | 7.2.1.4 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Wave 8.1.1 Task 7.1.1.1.1; Wave 8.1.1 Task 7.1.1.1.2 |
| Deliverables | Updated `apps/web/src/middleware.ts`; `apps/web/src/lib/billing/route-config.ts`; middleware integration tests |

**Acceptance Criteria:**
- `route-config.ts` exports `TIER_REQUIRED_ROUTES: Record<string, SubscriptionTier>` — a plain object mapping route prefixes to minimum required tier; no hardcoded tiers in `middleware.ts` itself.
- Tier is resolved with a lightweight Supabase service-role query (`SELECT subscription_tier FROM profiles WHERE id = $uid`); the result is attached as `x-user-tier` header.
- Redirect on tier mismatch uses `NextResponse.redirect` with a `?reason=tier` query param for the pricing page to display a contextual message.
- If the profile query fails (Supabase unavailable), middleware logs the error and allows the request through with tier `'free'` — degrading gracefully, not blocking the user.
- Unit tests mock the Supabase client and verify redirect behavior for all tier combinations.

---

## Task Dependencies

```
Wave 8.1.1 (subscription_tier column, TIER_LIMITS) — prerequisite for this entire wave

Task 7.2.1.1.1 (cap guard utility)
  └── Task 7.2.1.1.2 (entity creation handler integration)
  └── Task 7.2.1.2.1 (reminder creation handler integration)

Task 7.2.1.3.1 (memory window utility)
  └── Task 7.2.1.3.2 (apply to Sentinel + inline retrieval)

Task 7.2.1.4.1 (middleware tier enforcement) — depends only on Wave 8.1.1; parallelizable with cap-guard tasks
```

**Critical path:** Wave 8.1.1 → 7.2.1.1.1 → 7.2.1.1.2 + 7.2.1.2.1 (parallel) and 7.2.1.3.1 → 7.2.1.3.2.
**Parallelizable:** memory-window tasks (7.2.1.3.x) and middleware task (7.2.1.4.1) can run concurrently with cap-guard integration tasks once 7.2.1.1.1 is done.

## Definition of Done

- Entity cap: Free user blocked at entity #10; tool handler returns structured cap-hit result; Core/Pro unlimited — confirmed by integration test.
- Reminder cap: Free blocked at 1/day; Core at 3/day; Pro unlimited — confirmed by integration test.
- Memory window: `getMemoryWindowCutoff` is the single source; both Sentinel and inline retrieval apply it; memories older than window stop surfacing but are not deleted; upgrading tier immediately restores them — confirmed by integration test with 48h-old memory.
- Middleware attaches `x-user-tier` header; tier-gated pages redirect Free users to `/pricing` — confirmed by middleware integration test.
- No memory row is deleted as a side effect of any tier enforcement in this wave.
- All existing tests continue to pass (enforcement is additive).
- CI passes with new tests added.

## Infrastructure Specifications

### Database

- No new migrations required in this wave.
- **`match_memories` RPC update:** add optional `created_after timestamptz DEFAULT NULL` parameter; add `AND (created_after IS NULL OR created_at >= created_after)` to the WHERE clause. Migration name: `<timestamp>_update_match_memories_window_param`.
- No data deleted; no schema destructive changes.

### API

- No new routes in this wave.
- **Tool handlers modified (internal only):** entity-creation handler, reminder-creation handler — behavior change is internal; JSON schema and route signatures unchanged.
- **Middleware extended:** `apps/web/src/middleware.ts` — existing file modified to add tier resolution and route-gating logic.

### UI

- No new UI components in this wave; the cap-hit response from tool handlers is surfaced by the existing chat message rendering (the model relays the cap reason as natural language to the user).
- Upgrade prompt UI is covered by Wave 8.3.1 (Conversion UX).

### Testing

- **Unit tests:** `cap-guard.ts` — all tier/count combinations; error path (DB failure → `cap_check_error`).
- **Unit tests:** `memory-window.ts` — all three tiers; window boundary accuracy.
- **Unit tests:** `middleware.ts` — mocked Supabase; tier header attachment; redirect on gated route; fallback on DB error.
- **Integration tests:** entity cap at 10/11 for Free; reminder cap at 1/2 for Free, 3/4 for Core; memory retrieval with 48h-old memory for Free vs Core.
- **Regression:** all existing chat/task/reminder tests pass unchanged.
- **Coverage target:** >80% branch coverage on `cap-guard.ts`, `memory-window.ts`, and the route-config logic.

### Deployment

- No new env vars required by this wave (TIER_LIMITS is code; DB query uses existing Supabase vars).
- **Vercel middleware** runs at the edge; ensure the Supabase service-role query from edge is compatible (use the anon client with the user's JWT or the service-role client depending on Vercel Edge Runtime constraints — evaluate and document the chosen approach).

### Monitoring

- Log every cap-hit event (user_id, cap_type, current_count, tier) — structured; used to track conversion pressure.
- Log every tier-based page redirect (user_id, route, user_tier, required_tier) — structured.
- Alert if the cap-guard DB query error rate rises above 0 (a DB failure silently allows creates, which is wrong).

## Handoff Requirements

- Wave 8.1.1 must be complete: `subscription_tier` column, `TIER_LIMITS` constant, and the tier-utility functions are prerequisites.
- Epic 2 (memory retrieval paths) must be present: the Sentinel and inline assembly code must exist before Task 7.2.1.3.2 can apply the window filter.
- Epic 2 (entity_profiles table) must exist before Task 7.2.1.1.2.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Memory window enforcement "feels broken" — user confused why old memories stopped appearing | Medium | Medium | Clear in-chat message from the model when retrieval returns fewer results than expected; upgrade CTA references the memory window explicitly (Wave 8.3.1) |
| Sentinel code (Epic 2) may not yet exist when this wave begins | High — blocks 7.2.1.3.2 | Low-Medium | Task 7.2.1.3.1 (utility) can be delivered; 7.2.1.3.2 is a blocker until Epic 2 lands |
| Vercel Edge Runtime incompatibility with service-role Supabase client in middleware | Medium | Medium | Use the user's JWT + anon client in middleware (RLS-safe SELECT of own profile); document decision |
| Race condition in cap check (concurrent tool calls) | Low | Low | The COUNT query is consistent within a transaction; acceptable at per-user scale without optimistic locking |
| Cap-check latency adding perceptible delay to every tool call | Low | Low | Single indexed lookup on `user_id`; acceptable; benchmark if observed |

## Related Documentation

- Product Vision: `docs/architecture/_main/01-Product-Vision.md` §Pricing Strategy
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` Feature 9, UC-22, UC-23, UC-24
- Architecture: `docs/architecture/_main/04-Architecture.md` §Authentication and Authorization, §Data Governance
- ADR-011: `docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md`
- Epic 8: `docs/implementation/_main/epic-7-productization.md`
- Wave 8.1.1: `docs/implementation/iterations/wave-8.1.1-stripe-billing-and-tiers.md`
