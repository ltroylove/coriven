# Wave 1.2.1 — Production Smoke Test (Task 1.2.1.3.1)

**Target:** https://coriven.app (project `coriven-web`, Vercel)
**Date:** 2026-06-29
**Build verified:** title = "Coriven"; deploy from `main`.

## Automated checks (verified by tooling) ✅

| # | Check | Result |
|---|---|---|
| A1 | HTTPS + valid cert | ✅ `Strict-Transport-Security: max-age=63072000` |
| A2 | Root loads, redirects to sign-in | ✅ `coriven.app` → 200 `…/signin?next=%2F` |
| A3 | Unauthenticated data access blocked | ✅ `/api/tasks/due` (no session) → redirected to `/signin` by middleware (data protected) |
| A4 | Rebrand deployed | ✅ `<title>Coriven</title>` |
| A5 | No middleware crash | ✅ no `x-vercel-error` header |
| A6 | Secret scan (Task 1.2.1.4.1) | ✅ no `.env` files tracked; no hardcoded secrets in source |
| A7 | `.env.example` accurate (Task 1.2.1.1.2) | ✅ root `.env.example` present, all phases |
| A8 | Env vars set (Task 1.2.1.1.1) | ✅ 6 Foundation vars in Vercel Production |

> Note: `/api/tasks/due` returns an HTML redirect to `/signin` (not 401 JSON) for unauthenticated browser requests because the SSR middleware guards all routes. The route's own 401 is defense-in-depth behind it. Acceptable for Phase 1.

## Manual checks (require an authenticated session — owner to complete) ⏳

Sign in at https://coriven.app with the owner account, then:

- [x] **M1 — Sign in** succeeds and redirects into the app (not back to /signin).
- [x] **M2 — Create a task** via the Tasks UI → it persists (still there after refresh).
- [x] **M3 — Create a reminder via chat**: send "remind me to call mom tomorrow at 9am" → a task with a reminder is created (`task_reminders` row with the right `remind_at`).
- [x] **M4 — Chat SSE** streams a response (assistant text appears, no error).
- [x] **M5 — Conversation reload** (wave 1.4.1): refresh mid-conversation → prior messages reappear.
- [x] **M6 — Sign out** → returns to `/signin`.

## Status
Automated surface: **PASS**. Authenticated flows: **PASS (M1–M6 completed 2026-06-29).** Wave 1.2.1 is fully closed.
