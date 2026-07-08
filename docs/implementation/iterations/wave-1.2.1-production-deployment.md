---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "1"
feature: "1.2"
wave: "1.2.1"
agents: []
tags: [coriven, deployment, vercel, environment, smoke-test, production]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/02-Product-Plan.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
---

# Wave 1.2.1: Production Deployment

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 1.2.1 |
| Feature | 1.2 — Production Deployment |
| Epic | 1 — Foundation Closeout |
| Status | Planning |
| Scope | Deploy the web app to Vercel from `main`; configure all required env vars; verify auth, chat (SSE), tasks, and reminders work end-to-end in production. |
| Wave Goal | Coriven is live on Vercel with all critical flows verified against the production Supabase database, and the team can safely hand off a stable foundation to Feature 1.3. |

**Wave Philosophy:** Scope-based — this wave closes when production is verified, not on a fixed date.

## Wave Goals

1. All env vars from Architecture Appendix C required for Foundation are set in the Vercel project and verified — no missing secrets block the deploy (Product Plan §17.1, NFR availability).
2. Auth (sign-in/sign-out), task CRUD, reminder creation, and the chat/SSE flow each pass a manual smoke test against the production deployment, satisfying Product Plan success criterion #1.
3. A documented `.env.example` accurately reflects every env var in use, so future contributors can onboard without guessing (Architecture security invariant: no secrets in code, `.env.example` as template).

## User Stories

---

### Story 1.2.1.1 — Environment Configuration

**As the** developer,  
**I want** all required environment variables set in Vercel's production environment,  
**So that** the app can connect to Supabase, Anthropic, and other services without runtime errors.

**Reference:** Architecture Appendix C; Product Plan §17.1; ADR-001 (Supabase day-one).

**Priority:** Critical  
**Estimated hours:** 3

**Acceptance Criteria:**
- All Foundation env vars from Architecture Appendix C are present in the Vercel production project (not just preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` is marked server-only (not exposed to the browser) in Vercel.
- `.env.example` at repo root lists every var above with placeholder values and a comment; it is committed to version control.
- `.env.local` is not committed (confirmed via `.gitignore`).
- No hardcoded secrets appear anywhere in `apps/web/src/`.

---

#### Task 1.2.1.1.1 — Set Production Env Vars in Vercel

| Field | Value |
|---|---|
| Parent Story | 1.2.1.1 |
| Agent | devops-specialist |
| Estimation | 2h |
| Dependencies | Wave 1.1.1 Definition of Done met |
| Deliverables | Vercel project dashboard showing all Foundation env vars set; screenshot or verification note |

**Acceptance Criteria:**
- Vercel production environment contains all six Foundation vars listed in Story 1.2.1.1.
- `SUPABASE_SERVICE_ROLE_KEY` is set as a "Sensitive" / server-only variable.
- `NEXT_PUBLIC_APP_URL` is set to the production Vercel URL (e.g., `https://coriven.vercel.app`).
- `CRON_SECRET` is a randomly generated string of ≥32 characters.

---

#### Task 1.2.1.1.2 — Audit and Update `.env.example`

| Field | Value |
|---|---|
| Parent Story | 1.2.1.1 |
| Agent | backend-specialist |
| Estimation | 1h |
| Dependencies | Task 1.2.1.1.1 (know the full var list) |
| Deliverables | Updated `.env.example` committed to the repo |

**Acceptance Criteria:**
- `.env.example` contains every env var required by the Foundation phase with placeholder values.
- A one-line comment above each var describes its purpose and where to obtain the value.
- `.env.local` entry exists in `.gitignore` and is confirmed not tracked by git.

---

### Story 1.2.1.2 — Vercel Auto-Deploy from `main`

**As the** developer,  
**I want** the Vercel project configured to auto-deploy from the `main` branch,  
**So that** merging a PR to `main` triggers a production deploy without manual steps.

**Reference:** Architecture §"Deployment Architecture"; Product Plan CI/CD pipeline.

**Priority:** Critical  
**Estimated hours:** 2

**Acceptance Criteria:**
- The Vercel project's production branch is set to `main`.
- A push to `main` triggers a Vercel production build.
- The build passes (exit 0) — `npm run build` completes with no errors.
- The deploy URL is the canonical production URL (not a preview URL).

---

#### Task 1.2.1.2.1 — Configure and Trigger Initial Production Deploy

| Field | Value |
|---|---|
| Parent Story | 1.2.1.2 |
| Agent | devops-specialist |
| Estimation | 2h |
| Dependencies | Task 1.2.1.1.1 (env vars must be present before build succeeds) |
| Deliverables | Vercel production deploy URL; build log showing success |

**Acceptance Criteria:**
- Vercel project root is set to `apps/web` (monorepo config).
- `npm run build` in the Vercel build environment exits 0.
- The production URL resolves and returns the Next.js app (HTTP 200 on `/`).
- Build log contains no TypeScript or ESLint errors.

---

### Story 1.2.1.3 — Production Smoke Test

**As the** owner,  
**I want** to verify that auth, task management, and chat all work in the production environment,  
**So that** I can use Coriven as my daily driver on Vercel with confidence.

**Reference:** Product Plan §17.1 success criteria; Business Requirements NFR availability; UC-1, UC-2, UC-3.

**Priority:** Critical  
**Estimated hours:** 3

**Acceptance Criteria:**
- Sign-in with email/password succeeds and redirects to the tasks/chat view.
- Creating a task via the UI persists it in the production Supabase database.
- Creating a reminder via chat ("remind me to call mom tomorrow at 9am") results in a `task_reminders` row with the correct `remind_at`.
- The chat SSE stream delivers a response (text appears in the UI without errors).
- Sign-out redirects to the login page.
- All smoke-test steps are recorded in a checklist (see Acceptance Criteria below for the checklist).

---

#### Task 1.2.1.3.1 — Execute and Record Production Smoke Test

| Field | Value |
|---|---|
| Parent Story | 1.2.1.3 |
| Agent | quality-control |
| Estimation | 3h |
| Dependencies | Task 1.2.1.2.1 (production deploy must be live) |
| Deliverables | Completed smoke-test checklist committed to `docs/implementation/iterations/` or equivalent |

**Acceptance Criteria:**
- Checklist covers: sign-in, create task (UI), create reminder (chat), verify SSE stream, sign-out.
- Each item is marked pass/fail with a brief note.
- Any failures are filed as follow-up issues before this wave closes.
- Checklist is committed to the repo as a durable record.

---

### Story 1.2.1.4 — Security: No Secrets in Code

**As the** developer,  
**I want** to confirm that no secrets or env-var values are hardcoded anywhere in the codebase,  
**So that** committing to a public or semi-public repository does not expose credentials.

**Reference:** Architecture §"Application Security" (anti-hardcoding rule); Business Requirements §"Data Protection".

**Priority:** High  
**Estimated hours:** 1

**Acceptance Criteria:**
- A scan of `apps/web/src/` and `apps/tray/src/` finds no hardcoded Supabase keys, Anthropic keys, or other secrets.
- All config values are accessed via `process.env.*`.
- `.env.local` is listed in `.gitignore` and does not appear in `git status` or `git log`.

---

#### Task 1.2.1.4.1 — Secret Scan

| Field | Value |
|---|---|
| Parent Story | 1.2.1.4 |
| Agent | quality-control |
| Estimation | 1h |
| Dependencies | None (can run in parallel) |
| Deliverables | Verification note; any findings remediated before wave closes |

**Acceptance Criteria:**
- Grep for known secret patterns (e.g., `eyJ`, `sk-ant-`, `service_role`) finds no hits in committed source files.
- `.env.local` is absent from `git ls-files`.

---

## Task Dependencies

```
Task 1.2.1.1.1 (set env vars)
    └── Task 1.2.1.1.2 (update .env.example)  [parallel with 1.2.1.2.1]
    └── Task 1.2.1.2.1 (trigger deploy)
            └── Task 1.2.1.3.1 (smoke test)

Task 1.2.1.4.1 (secret scan) — independent; can run in parallel with all others
```

**Critical path:** 1.2.1.1.1 → 1.2.1.2.1 → 1.2.1.3.1

## Definition of Done

- [ ] All six Foundation env vars are set in Vercel production; none hardcoded in source.
- [ ] `npm run build` exits 0 on Vercel; production deploy URL resolves.
- [ ] Smoke-test checklist complete with all items passing.
- [ ] `.env.example` committed and accurate; `.env.local` absent from git history.
- [ ] `npm run typecheck` still exits 0 (no regressions from this wave).
- [ ] Secret scan passes — no credentials in committed files.

## Infrastructure Specifications

### Deployment

| Item | Value |
|---|---|
| Platform | Vercel |
| Production branch | `main` |
| Monorepo root | `apps/web` |
| Build command | `npm run build` (Next.js 15) |
| Deploy trigger | Push / merge to `main` (auto) |
| Rollback | Vercel dashboard instant rollback to prior deployment |

**Environment variables (Foundation phase — all required before first deploy):**

| Variable | Scope | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase project settings (sensitive) |
| `ANTHROPIC_API_KEY` | Server only | Anthropic console |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Production Vercel URL |
| `CRON_SECRET` | Server only | Generate: `openssl rand -hex 32` |

Variables not required until later phases (do not need to be set now): `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `DATA_ENCRYPTION_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

### Testing

| Level | Approach | Target |
|---|---|---|
| Manual smoke | Checklist of 5 core flows in production (Story 1.2.1.3) | All pass |
| Secret scan | Grep for known secret token patterns | Zero hits in committed files |
| Build verification | Vercel build log | Exit 0, no TS/lint errors |

No automated e2e tests are introduced in this wave (deferred to a later quality wave). The smoke-test checklist is the acceptance gate.

### Monitoring

- Vercel deployment dashboard: monitor build success/failure per deploy.
- Vercel Function logs: watch for 500 errors in the first 24h post-deploy.
- No new alerting infrastructure introduced in this wave.

## Handoff Requirements

Feature 1.3 (Tray Reliability & Tauri Decision) requires:
- A live production URL for `NEXT_PUBLIC_APP_URL` / `APP_URL` that the tray can poll.
- `/api/tasks/due` endpoint verified working in production (confirmed by smoke test).

Feature 1.4 (Chat Conversation Reload) requires:
- Production deploy live so the fix can be verified end-to-end in the production environment.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Missing env var causes runtime 500 | High | Medium | Checklist from Appendix C; verify each var before smoke test |
| Vercel monorepo root misconfigured | Medium | Low | Set `apps/web` as root in Vercel project settings before first build |
| Supabase production DB lacks migrations | Medium | Low | Run `npx supabase db push` against the linked production project before smoke test |
| SSE streaming blocked by Vercel edge config | Low | Low | Verify `Cache-Control: no-cache, no-transform` header in the chat route; test SSE on prod |

## Related Documentation

- Epic: `docs/implementation/_main/epic-1-foundation-closeout.md`
- Architecture: `docs/architecture/_main/04-Architecture.md` (Appendix C, §"Deployment Architecture")
- Product Plan: `docs/architecture/_main/02-Product-Plan.md` (§17.1, CI/CD pipeline)
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` (NFR availability, §"Data Protection")
