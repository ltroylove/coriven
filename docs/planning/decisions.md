# Architecture Decision Log

Decisions made during initial brainstorming (2026-06-19). Updated as the project evolves.

---

## Product Vision

**Status:** Decided

Build a personal AI assistant for personal use first, with every architectural decision made to enable productization later without rewrites.

End-state feature set:
- **A) Life/schedule management** — reminders, calendar, tasks, daily briefings
- **B) Knowledge & research companion** — answers questions, summarizes, remembers context
- **C) Automation hub** — runs workflows, talks to APIs, acts on your behalf

**First milestone:** Task & reminder engine (feature set C above).

---

## Personal vs. Business

**Status:** Decided

Start as a personal tool. Build clean, not big. Productization-friendly choices made upfront at near-zero cost.

Non-negotiable productization rules baked in from day one:
- API-first: UI always talks to a backend API, never directly to data
- Auth from day one: login layer exists even for single user
- `user_id` on every database record — multi-tenancy is a config change, not a rewrite
- Supabase Postgres from day one — no SQLite
- Web-first UI: browser today, Electron/Tauri wrapper for desktop later, PWA for mobile

---

## Tech Stack

**Status:** Decided

**TypeScript / Node.js full-stack.**

Rationale:
- One language end-to-end
- Strong typing makes agentic development more reliable (agents catch type errors, IDEs flag mismatches)
- Large training corpus means AI agents assisting development have high accuracy
- Next.js for full-stack framework (API routes + React frontend in one repo)

---

## UI Surfaces

**Status:** Decided

Three surfaces, built incrementally:
1. **Web UI** — primary interface, browser-based dashboard
2. **Chat / conversational** — natural language input
3. **System tray / background service** — Windows notifications, runs quietly

---

## Data Storage

**Status:** Decided

Supabase (managed Postgres) from day one — no SQLite at any point.

- Dev: local Supabase CLI (`supabase start`) mirrors production exactly
- Prod: Supabase cloud (same org as PrepForge)
- Migrations: SQL-first in `supabase/migrations/`, same workflow as PrepForge
- Types: auto-generated via `supabase gen types typescript --linked`

---

## AI Integration

**Status:** Decided

Claude API with tool use (function calling).

- Chat interface supports tool use from day one
- Claude can both respond conversationally AND call registered tools to act on the system (create tasks, set reminders, query data, trigger automations)
- Users opt-in to each tool individually — every tool has a registered identity and a per-user preference; AI checks permissions before calling
- Per-tool opt-in is productization-ready (e.g., paid plans unlock more tools)

---

## Hosting & Cloud Accounts

**Status:** Decided

**Vercel:**
- Add as a new project under existing Vercel account — one account covers unlimited projects
- Stay on Hobby plan while personal use only (no revenue, no commercial use)
- Upgrade to Pro ($20/month, covers all projects including PrepForge) when productizing or going commercial
- **Deploy in Phase 8 only** — run locally until then

**Supabase:**
- Add as a new project under existing Supabase org (same org as PrepForge)
- Free tier allows 2 active projects per org — PrepForge is one, this is two
- If already at 2 projects, Pro is ~$25/month per project
- Pricing is per-project (unlike Vercel which is per-account)
- **Use local Supabase CLI for Phases 1–7** — connect to cloud in Phase 8

---

## Open Questions

- Mobile strategy (PWA vs. React Native — deferred)
- Notification delivery on non-Windows platforms (deferred to productization)
