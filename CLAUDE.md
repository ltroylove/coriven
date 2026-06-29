# Coriven

An AI-powered personal assistant (product name: **Coriven**) — task management, reminders, and Claude-powered chat with tool use.

## Project Structure

```
apps/
  web/    — Next.js 15 app (UI + API routes) → deployed to Vercel
packages/
  types/  — shared TypeScript types
supabase/
  migrations/  — SQL-first DB migrations
docs/
  planning/    — design docs and architecture decisions
```

> The desktop tray is a **future Tauri app** (cross-platform thin shell over the API — see blueprint §13). The earlier Node.js Windows daemon (`apps/tray`) was removed; it is not being maintained.

## Key Docs

- **Master blueprint (the only active doc — start here):** `docs/planning/2026-06-24-coriven-master-blueprint.md` — the single source of truth, consolidating all prior planning/research/vision. Where anything conflicts, the most recent wins (see its §0.4).
- **`docs/archive/`** — all earlier planning/research/vision docs, now obsolete. Historical record only; do not plan or build from them. See `docs/archive/README.md`.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode everywhere)
- **Styling:** Tailwind CSS 4
- **Database:** Supabase (Postgres + Auth)
- **AI:** Anthropic Claude API with tool use
- **Hosting:** Vercel (web); desktop tray is a future Tauri app

## Development Setup

```bash
# Install all dependencies
npm install

# Start the web app
npm run dev

# Type check everything
npm run typecheck
```

## Conventions

- `@/*` path alias maps to `apps/web/src/*`
- Supabase clients live in `apps/web/src/lib/supabase/` (4 variants — see design doc)
- Server Actions in `apps/web/src/app/actions/`
- Shared types imported from `@personal-assistant/types`
- Never commit `.env.local` — use `.env.example` as the template
- All DB tables have `user_id` referencing `auth.users.id` with RLS policies

## Git Workflow

- `development` — active work
- `main` — production (auto-deploys to Vercel)
- Never merge directly to `main`; always PR from `development`

## Supabase Migrations

```bash
# Create a new migration
npx supabase migration new <description>

# Apply migrations locally
npx supabase db push

# Generate TypeScript types
npx supabase gen types typescript --linked > apps/web/src/types/supabase.ts
```
