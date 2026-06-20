# Personal Assistant

An AI-powered personal assistant — task management, reminders, and Claude-powered chat with tool use.

## Project Structure

```
apps/
  web/    — Next.js 15 app (UI + API routes) → deployed to Vercel
  tray/   — Node.js background daemon (Windows tray + notifications)
packages/
  types/  — shared TypeScript types across apps
supabase/
  migrations/  — SQL-first DB migrations
docs/
  planning/    — design docs and architecture decisions
```

## Key Docs

- Architecture decisions: `docs/planning/decisions.md`
- Full design spec: `docs/planning/2026-06-19-personal-assistant-design.md`
- Implementation plan: `docs/planning/2026-06-19-implementation-plan.md`

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode everywhere)
- **Styling:** Tailwind CSS 4
- **Database:** Supabase (Postgres + Auth)
- **AI:** Anthropic Claude API with tool use
- **Hosting:** Vercel (web) + local install (tray)

## Development Setup

```bash
# Install all dependencies
npm install

# Start the web app
npm run dev

# Start the tray daemon
npm run tray:dev

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
