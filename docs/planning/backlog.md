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

All scheduled jobs (nightly pattern detection, Friday weekly review, daily briefing) currently run in UTC. The cron schedules in `vercel.json` are hardcoded UTC times with no awareness of the user's actual local time, so notifications fire at whatever UTC maps to — which may be 3am locally.

**The fix (simple — currently single-user):**

Since Vercel Cron only supports one global UTC schedule, the approach is to work backwards from what the user wants:

1. **Capture timezone in Settings UI** — add a timezone field to the account/settings page. Pre-fill it from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) so it requires no typing. Store as an IANA string (e.g. `America/Chicago`) in `profiles.timezone`. Show a live preview of the current local time in that zone so the user can confirm it's right.

2. **Compute UTC offset and update cron schedules** — when the user saves their timezone, a server action computes the UTC equivalent of each desired local trigger time (e.g. "9pm local" for the nightly job, "5pm local Friday" for weekly review) and rewrites the cron expressions in `vercel.json` (or an equivalent config surface), then redeploys. The user always sees and sets their local time; the UTC math happens behind the scenes.

3. **Display local time everywhere** — all timestamps shown in the UI (briefings, task due dates, notification history) are converted to `profiles.timezone` before display. Nothing shows raw UTC to the user.

4. **Multi-user path (future):** when there are multiple users with different timezones, shift to an hourly cron that checks whether each user's desired trigger time has passed since the last run. No architecture change needed for now.

**Why:** Notifications at 3am are worse than no notifications — they erode trust and train users to ignore the app. The fix is straightforward for a single user: capture their timezone once, do the UTC math, and show them local time everywhere.

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
