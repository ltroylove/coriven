---
lastupdated: "2026-07-08"
type: backlog
status: Active
product:
  - "coriven"
---

# Coriven Backlog

Unscheduled items waiting to be assigned to an Epic or Feature. Add here first; move to an Epic doc when planned.

---

## Context Building

### BL-001 — Sentinel sync/async toggle
**Area:** Epic 2 (Persistent Memory) / Feature 2.5 (Sentinel)

Allow rapid switching between two context-build modes to compare latency vs. quality:

- **Async mode (current default):** Sentinel fires in the background after each message; chat reads the pre-built package from Upstash/Supabase (~1ms read path). Lowest latency; context may be one message stale.
- **Sync mode:** Context package is built fresh and awaited _before_ each LLM call. Higher latency (Haiku extraction + embedding pass blocks the response); always current.

The toggle should be a single env var or admin UI switch (`SENTINEL_MODE=async|sync`) so it can be flipped without a deploy for A/B testing. Both paths must share the same context schema — only the timing differs.

**Why:** Validate whether the latency cost of sync mode produces measurably better response quality before committing to one approach permanently.

---

## Design & UX

### BL-002 — UI/UX overhaul
**Area:** Epic 8 (Productization) / candidate Feature 8.7

The current UI is functional and sufficient for testing but is generic (plain Tailwind, no visual identity, no design system). Needs a full design pass before public launch:

- Establish a visual language (color, type scale, spacing, component library)
- Redesign core surfaces: Chat, Today, Tasks, Memory, Goals, Constraints, Integrations
- Mobile-responsive layouts across all pages
- Empty states, loading states, error states
- Micro-interactions and transitions
- Accessibility audit (WCAG 2.1 AA)
- Design tokens committed to the codebase (Tailwind theme extension or CSS custom properties)

**Why:** First impressions drive trial conversion. The value prop is strong; the UI needs to match it before productization.

---

## Scheduling & Notifications

### BL-004 — Timezone-aware scheduling and user timezone preference
**Area:** Epic 7 (Proactive Intelligence) / cross-cutting concern for all cron jobs and notification delivery

All scheduled jobs (nightly pattern detection, Friday weekly review, daily briefing) currently run and deliver notifications in UTC. This means the "Friday 5pm" weekly review fires at a time that may be the middle of the night for users outside UTC, and the nightly cron similarly has no relationship to the user's actual day.

**Problems today:**
- `vercel.json` cron schedules are hardcoded in UTC with no per-user offset
- `profiles` table has a `timezone` field but it is not reliably populated and not used by any job
- The tray polls and delivers notifications whenever the cron fires, regardless of whether the user is awake

**What needs to happen:**

1. **User timezone onboarding** — during first login (or a settings page), prompt the user to confirm their timezone. Browser `Intl.DateTimeFormat().resolvedOptions().timeZone` can pre-fill this so it requires zero typing. Store in `profiles.timezone` as an IANA timezone string (e.g. `America/Chicago`).

2. **Timezone setting in Settings UI** — expose `profiles.timezone` as an editable field in the account/settings page so users can correct it later. Show the current local time in that timezone as a live preview so they can confirm it's right.

3. **Job scheduling respects timezone** — the nightly detect-patterns job and weekly review job should read `profiles.timezone` per user and either:
   - **Option A (simpler):** Run the cron on a fixed UTC schedule but skip users whose local time is outside a quiet-hours window (e.g. don't deliver if local time is 10pm–7am).
   - **Option B (correct):** Shift the cron schedule per user timezone — complex with Vercel Cron (single global schedule), so this likely means the cron fires frequently (e.g. every hour) and the job checks whether each user's local time has crossed the intended trigger time since the last run.

4. **Quiet hours / do-not-disturb** — don't fire tray notifications during the user's night. The tray poll can check the user's local time before surfacing a notification and defer it until morning (e.g. 8am local) if the current local time is outside the delivery window.

**Recommended approach:** Option A for the cron (simpler, ships fast), combined with a quiet-hours check in the tray before firing any notification. Full per-user cron scheduling (Option B) can come later when there are multiple users with meaningfully different timezones.

**Why:** Notifications at 3am are worse than no notifications — they erode trust and train users to ignore the app. Timezone correctness is table stakes for any scheduling feature.

---

## Assistant Intelligence

### BL-003 — Product self-knowledge ("what can you do?")
**Area:** Epic 2 (Persistent Memory) / Chat system prompt — candidate Feature 2.6 or standalone

When a user asks "what can you do?", "how do I add a task?", "what is a constraint?", etc., the assistant currently has no reliable knowledge of Coriven itself and either hallucinates, gives generic AI-assistant answers, or says it doesn't know. It needs accurate, always-current product knowledge.

**Approaches to evaluate (pick one when planning):**

1. **Static product knowledge block in the system prompt (simplest)**
   A dedicated `## About Coriven` section injected into every chat system prompt describing features, how-tos, and navigation. Authored and maintained as a markdown file (`lib/chat/product-knowledge.md`). Zero latency, always present. Downside: adds tokens to every request even when the user isn't asking about the app; must be kept in sync with the real UI manually.

2. **Tool: `get_product_help(topic)`**
   Claude detects a "how do I" / "what is" question and calls a tool that looks up the right section of product docs. Docs are stored as structured markdown in the repo and served via an API route. Only costs tokens when invoked. Downside: Claude must correctly identify the question as app-related and call the tool; adds a round-trip.

3. **RAG over product docs (most scalable)**
   Embed a help-doc corpus (features, how-tos, FAQs) and include relevant chunks in the context package alongside user memory. The Sentinel (or a parallel retrieval pass) fetches the top-k doc chunks relevant to the user's message before the LLM call. Scales to large doc sets; stays current if docs are re-embedded on change. Downside: most complex to build; requires a separate embedding namespace.

**Recommended starting point:** Option 1 (static block) to validate that the assistant actually answers correctly, then graduate to Option 2 or 3 if the token cost is a problem or the docs outgrow the context window.

**Why:** Users will ask the assistant about itself constantly. Getting this wrong erodes trust immediately — if the assistant doesn't know its own app, users assume it doesn't know anything else either.

---
