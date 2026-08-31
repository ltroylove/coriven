# Coriven

An AI personal assistant that remembers — tasks, reminders, goals, and a persistent memory of the
person it works for, driven by Claude with tool use.

Most chat assistants start from zero every session. Coriven's central design problem is the opposite:
how to carry genuine context forward across sessions without either flooding the model's window or
silently acting on a stale belief about the user.

> Built as a personal project. Web app plus a Windows desktop tray client.

---

## What it does

- **Conversational task and reminder management** — Claude drives the app through tool use rather
  than the user driving a form. Tasks, goals, schedules, and reminders are all first-class records.
- **Persistent memory across sessions.** Facts extracted from conversation are stored, superseded
  rather than overwritten, and re-assembled into a bounded context package on each turn.
- **A daily briefing** built deterministically, not generated freehand — so it says the same thing
  about the same day.
- **Proactive scheduled jobs** that can act between sessions rather than only on prompt.

## Design decisions worth reading

The architecture is documented in [`docs/architecture/`](docs/architecture/), including 9 ADRs. Three
that carry most of the weight:

- **Async memory extraction with a pre-built context package** — extraction runs fire-and-forget
  after a turn is persisted, then dual-writes an assembled package to Redis and Postgres. The read
  path on the next turn is a single cached fetch instead of a live assembly, which is what keeps
  conversational latency flat as memory grows.
- **A behavioral-constraint pre-action gate** ([ADR-007](docs/architecture/decisions/ADR-007-behavioral-constraint-pre-action-gate.md))
  — the model's proposed actions are checked against explicit constraints *before* execution, not
  corrected afterward.
- **An approval-queue audit gate** ([ADR-009](docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md))
  — anything consequential lands in a queue with an audit trail rather than executing silently. An
  assistant with write access to your life needs a paper trail.

## Stack

| | |
|---|---|
| **Web** | Next.js 15 (App Router), React 19, TypeScript strict mode, Tailwind 4 |
| **Data** | Supabase Postgres + Auth, row-level security on every table, 30 SQL-first migrations |
| **AI** | Anthropic Claude with tool use |
| **Cache** | Upstash Redis for the assembled context package |
| **Desktop** | Tauri tray client (Windows-first) |

**Scale:** 176 TypeScript source files in the web app, 55 test files, 30 migrations, 9 ADRs,
144 commits.

## Layout

```
apps/web      Next.js application
apps/tray     Tauri desktop tray client
packages/     shared types
supabase/     schema migrations, RLS policies
docs/         architecture, ADRs, and per-wave implementation records
```

## Running it

```bash
npm install
cp .env.example .env.local     # fill in Supabase, Anthropic, and Upstash credentials
npm run dev                    # web app
npm run tray:dev               # desktop tray client
```

```bash
npm run typecheck
npm run lint
npm run test
```

Requires a Supabase project (apply `supabase/migrations` in order), an Anthropic API key, and an
Upstash Redis instance. No credentials are committed; `.env.example` lists every variable needed.

## License

MIT — see [LICENSE](LICENSE).
