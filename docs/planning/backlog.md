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

### BL-004 — Timezone-aware cron scheduling
**Area:** Epic 7 (Proactive Intelligence) / `vercel.json` cron config + Settings UI

The cron expressions in `vercel.json` are hardcoded UTC times. All data is correctly stored in UTC and displayed as local time — that's not the issue. The problem is purely that the cron fires at a UTC time that doesn't correspond to the user's preferred local delivery time (e.g. "Friday 5pm" or "9pm nightly"), so notifications arrive at the wrong hour.

**The fix:**

1. **Capture timezone in Settings** — add a timezone field to the settings page, pre-filled from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Store as an IANA string (e.g. `America/Chicago`) in `profiles.timezone`.

2. **Rewrite cron expressions to match** — compute the UTC equivalent of each desired local trigger time and update the cron schedules in `vercel.json`. The user configures their local time; the UTC math is invisible.

**Multi-user note (future constraint):** a single global Vercel Cron schedule can't mean "9pm local" for two users in different timezones at the same time. When there are multiple users, the fix is an hourly cron that checks per user whether their desired local trigger time has been crossed since the last run.

**Why:** The cron firing at the wrong local time means notifications arrive at 3am. One-time fix: get the timezone, update the UTC cron expression.

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
