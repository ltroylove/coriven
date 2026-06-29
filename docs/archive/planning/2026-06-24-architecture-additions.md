# Coriven — Architecture Additions

**Date:** 2026-06-24  
**Status:** Active — supplements `2026-06-20-unified-vision.md`  
**Source:** Retained decisions from Polsia collaboration, stripped of Polsia-specific infrastructure

This document captures decisions and design details that are NEW relative to the unified vision doc. It does not replace that doc — it extends it. When these additions are fully implemented and validated, they should be merged into the relevant sections of the unified vision.

---

## 1. Entity Enhancements

### Aliases + Fuzzy Matching

The current `entity_profiles` table uses a single `name` field with a `UNIQUE(user_id, name)` constraint. Add an `aliases` array to support multiple names for the same entity.

**Resolution strategy (in order):**
1. Exact match on `name`
2. Exact match on any `aliases[]` entry
3. Fuzzy match: Levenshtein distance ≤ 2 on `name` and each alias
4. Contextual disambiguation: if two candidates score similarly, use surrounding conversation context

**Alias management:** When the user uses a new name for an existing entity, Coriven confirms or auto-adds to aliases after two successful resolutions.

**Schema addition:**
```sql
ALTER TABLE entity_profiles ADD COLUMN aliases text[] DEFAULT '{}';
```

### Temporal Tracking

Add tracking fields so the daily briefing can weight entities by recency and frequency of mention.

```sql
ALTER TABLE entity_profiles
  ADD COLUMN last_mentioned timestamptz,
  ADD COLUMN mention_count  integer DEFAULT 0,
  ADD COLUMN recency_weight float   DEFAULT 1.0;
```

**Decay rule:** `recency_weight` decays 10% per week without a mention. Higher weight = more likely to surface unprompted in daily briefing. Decay runs as part of the daily briefing cron job.

**On mention:** Increment `mention_count`, set `last_mentioned = now()`, reset `recency_weight` toward 1.0.

### RESOURCE Entity Type

Expand the `entity_type` enum to include `resource`: tools, subscriptions, and accounts in the user's life (e.g. "Notion", "Netflix", "AWS account").

```sql
ALTER TABLE entity_profiles DROP CONSTRAINT entity_profiles_entity_type_check;
ALTER TABLE entity_profiles ADD CONSTRAINT entity_profiles_entity_type_check
  CHECK (entity_type IN ('person', 'place', 'project', 'thing', 'resource'));
```

Update the `EntityType` shared type accordingly.

---

## 2. Momentum Formula

The unified vision defines momentum as `improving | stable | declining`. This is the calculation that produces those labels.

```
momentum_score = (tasks_completed_last_7d - tasks_created_last_7d) / max(tasks_created_last_7d, 1)

improving → momentum_score > 0.2
declining → momentum_score < -0.2
stalled   → -0.2 ≤ momentum_score ≤ 0.2
```

**Stale goal nudge:** A goal that has had zero task activity for 14 consecutive days triggers a Coriven-initiated nudge in the daily briefing (separate from the momentum label). The nudge fires once per 7-day period until activity resumes.

**Implementation:** Momentum recalculated nightly as part of the briefing cron. The result is written to `goals.momentum`. No real-time calculation needed.

---

## 3. Daily Briefing — Deterministic Template

**Decision:** Generate the briefing from a deterministic template with no LLM call.

The briefing assembles structured data from the database — no Claude invocation needed. This is faster, cheaper, and more predictable than generating prose via LLM.

**Template:**
```
GOOD MORNING, [NAME]. [DATE].

GOALS IN MOTION:
  [goal title] — [improving / stable / stalled]
  ...

UPCOMING (next 7 days):
  [task / reminder / deadline]
  ...

STALLED (needs attention):
  [goal title] — no activity in [N] days
  ...

APPROVALS PENDING: [N] items waiting for your review.
```

**When to use LLM:** On-demand "tell me more about my week" queries from the chat interface. The briefing delivery itself is template-only.

This changes the Phase 3 briefing implementation: replace the Claude generation call with a pure data-assembly function that formats this template.

---

## 4. Monetization Tiers

**Thesis:** Freemium with memory as the conversion mechanism. The entity cap is the paywall — users feel the value most acutely at the moment they can't add someone new.

### Tier Definitions

| | Free | Core | Pro |
|---|---|---|---|
| **Price** | $0 | $12/mo | $22/mo |
| **Entities** | 10 | Unlimited | Unlimited |
| **Memory window** | 24 hours | 7 days | 30 days |
| **Device sync** | Single device | Cross-device | Cross-device |
| **Reminders** | 1/day | 3/day | Unlimited |
| **Tray daemon** | Basic briefing only | Full daemon | Full daemon |

**Annual billing:** 2 months free (Core: $120/yr, Pro: $220/yr).

### Conversion Triggers

Designed so users feel the value at the moment they hit the limit:

1. **Entity cap hit** — "Coriven can't remember anyone else." Fires at entity #10 with upgrade prompt. Primary conversion driver.
2. **Cross-device sync** — Free users lose context when switching devices. Core removes the friction.
3. **Reminder frequency cap** — Free users hit 1/day and want more.
4. **Memory window** — After 7 days (Core) or 30 days (Pro), older memories stop surfacing. Users who've been using it for weeks feel this most.

### Early Adopter Strategy (Beta)

- **Lifetime deal:** $199 one-time, first 200 signups only. Announced at launch.
- **Free trial:** 7 days of Core access. No credit card at signup. Trial triggers at entity limit hit or reminder cap — not at signup. Contextual, not cold.
- **No CC at signup:** Reduces friction. Trial is earned through use, not given up front.

### Payment Implementation

Via our own Stripe account (MealPrepForge DBA). Subscription management with monthly + annual billing options. Webhooks update `profiles.subscription_tier` on payment events.

Tier enforcement in middleware: check `subscription_tier` before tool execution (entity creation, reminder creation) and page access.

---

## 5. Tauri Tray Daemon (Future — Productization)

**Current state:** We have a Node.js Windows-only tray daemon (already built, Phase 1).

**Future consideration for Mac + productization:** Tauri compiles a single codebase to both Windows `.exe` and Mac `.app`. When we open Coriven to Mac users, evaluate replacing the Node.js daemon with a Tauri app.

**Not a now-decision.** The Node.js daemon is sufficient for personal use. Tauri adds complexity (Rust build toolchain) that isn't justified until we have Mac users who need it.

---

## Implementation Priority

These additions slot into the existing phase plan as follows:

| Addition | Phase | Where |
|---|---|---|
| Entity aliases column | Phase 2 (memory) | Add to Phase 2 DB migration |
| Temporal tracking columns | Phase 2 (memory) | Add to Phase 2 DB migration |
| RESOURCE entity type | Phase 2 (memory) | Add to Phase 2 DB migration |
| Alias resolution in extraction | Phase 2 (memory) | Update `extract.ts` and `store.ts` |
| Momentum formula | Phase 3 (goals) | `briefing.ts` cron job |
| Deterministic briefing template | Phase 3 (goals) | Replace LLM briefing call |
| Monetization tiers | Phase 6 (productization) | Add to Stripe + middleware |
| Early adopter flow | Phase 6 (productization) | Landing page + payment flow |
| Tauri daemon | Phase 6 (productization) | Evaluate at that time |
