# Coriven — Cloud & External Services Setup Guide

**Purpose:** The complete, human-executed setup for every external service Coriven uses, across **all phases** (Epic 1 → Epic 7). Organized so you only do each piece **when the phase that needs it arrives** — but you can see the whole picture up front.

**Shared-account context:** Coriven is operated by **MealPrepForge LLC** as a DBA and **shares accounts** with MealPrepForge (PrepForge) where sensible. This guide marks every service as **Reuse** (same account as PrepForge) or **New**, and follows PrepForge's proven env-var and Supabase conventions so the two products stay consistent.

> `code font` = copy-paste. Replace `<angle-brackets>`. Never commit secrets — they go in Vercel env settings and local `.env.local` only (both gitignored).

---

## 0. Account model — reuse vs. new

| Service | Account | What Coriven needs | Needed by |
|---|---|---|---|
| **GitHub** | ♻️ Reuse | Repo `ltroylove/coriven` (already created) | done |
| **Vercel** | ♻️ Reuse (same login) | **New Vercel project** importing `coriven`. ⚠️ See §6 cron/commercial tiers | Epic 1 |
| **Supabase** | ♻️ Same org, **🆕 separate project** | New project `coriven` (isolates Coriven data from PrepForge) | Epic 1 |
| **Anthropic** | ♻️ Reuse account | API key (recommend a **separate key** for cost attribution) | Epic 1 |
| **OpenAI** | 🆕 New | Account + API key (embeddings; PrepForge doesn't use OpenAI) | Epic 2 |
| **Upstash** | 🆕 New | Account + Redis database (Sentinel cache) | Epic 2 |
| **Google Cloud** | 🆕 New | Project + OAuth client (Gmail + Calendar) | Epic 5 |
| **n8n** | 🆕 New (optional) | Self-hosted worker — optional; start with direct API | Epic 5 |
| **Stripe** | ♻️ Reuse (MealPrepForge LLC) | **New Products/Prices + new webhook endpoint** for Coriven | Epic 7 |
| **Web Push (VAPID)** | 🆕 New (self-generated keys) | Generate VAPID keypair | Epic 7 |
| **Apple Developer / Windows code-signing** | 🆕 New (optional) | Only if/when the Tauri tray ships signed builds | Tauri Go |

> **Why a separate Supabase project (not a shared DB):** clean data isolation, independent RLS, independent scaling, and a clean future spin-out if Coriven becomes its own LLC. Same Supabase **org**, different **project**.

---

## ▶ PHASE 1 — Required now (Epic 1: deploy + run)

> ✅ **STATUS: COMPLETE (2026-06-29).** Supabase project `coriven` linked (`vuiyrxkkyeidxpppwvgi`, region `us-east-2`); all 4 migrations applied; owner account `ltroylove@outlook.com` created + confirmed. Vercel project **`coriven-web`** deployed; 6 production env vars set; custom domain **`coriven.app`** live over HTTPS (DNS on Cloudflare). Vercel CLI is linked locally for future deploys. The steps below are retained as the reference/runbook.

Do **Supabase first**, then **Vercel** (Vercel needs Supabase values). ~30–45 min.

### Prerequisites
- [ ] Supabase account — https://supabase.com
- [ ] Vercel account (sign in with GitHub) — https://vercel.com
- [ ] Anthropic API key (`sk-ant-…`) — https://console.anthropic.com → API Keys
- [ ] A terminal (Git Bash) on this machine

### 1A. Supabase project
1. https://supabase.com/dashboard → **New project**. Name `coriven`, your org.
2. **Database Password:** Generate → **save it** (needed for `db push`).
3. **Region:** closest to you (Missouri → East/Central US).
4. Create and wait ~2 min.

### 1B. Grab Supabase credentials
**Project Settings → API** — copy three values:

| Dashboard field | Env var | Secret? |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | no |
| Project API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no |
| Project API keys → `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` | **yes** |

Also note your **project ref** (the `<ref>` in `https://<ref>.supabase.co`). (If only new "publishable/secret" keys show, use the **legacy** `anon`/`service_role` keys — the app uses those.)

### 1C. Apply database migrations
Creates `profiles`, `tasks`, `task_reminders`, `tool_permissions`, `conversation_messages` with RLS (4 migration files).

**CLI (from repo root `C:\Projects\Personal-Assistant`):**
```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push        # prompts for the DB password from 1A
```
**Manual fallback:** SQL Editor → run each file in `supabase/migrations/` **in filename order** (4 files, oldest first).

### 1D. Create your owner account
No public sign-up exists. Dashboard → **Authentication → Users → Add user → Create new user** → your email + password → **check "Auto Confirm User"** → Create.

### 1E. Deploy to Vercel
1. https://vercel.com/new → import **`ltroylove/coriven`** (the Vercel project is named **`coriven-web`**).
2. **Root Directory → `apps/web`** (required — monorepo). Framework auto-detects Next.js; leave build/install default (workspaces + `transpilePackages` already handle the shared types package).
3. **Add env vars** (Production) before deploying:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from 1B |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from 1B |
| `SUPABASE_SERVICE_ROLE_KEY` | from 1B (secret) |
| `ANTHROPIC_API_KEY` | your `sk-ant-…` (secret) |
| `NEXT_PUBLIC_APP_URL` | `https://coriven.app` (the custom domain) |
| `CRON_SECRET` | `openssl rand -hex 32` (secret; used from Epic 4) |

4. **Deploy.**

### 1F. Custom domain + finalize
- Confirm **Production Branch = `main`** (Settings → Git).
- **Custom domain** (`coriven.app`, registered + DNS at Cloudflare):
  1. Vercel → project → **Settings → Domains** → add `coriven.app` (and `www`). Set your preferred **primary**; the other redirects to it.
  2. In **Cloudflare DNS**, add the records Vercel shows — apex **A → `76.76.21.21`** (Vercel may show region IPs like `216.150.x.x`; use whatever Vercel displays) and **CNAME `www` → `cname.vercel-dns.com`**. Set both to **DNS only (grey cloud)** so Vercel manages SSL.
  3. Vercel auto-issues the HTTPS cert (`.app` requires HTTPS). Set `NEXT_PUBLIC_APP_URL` to match the primary, then **redeploy**.
- Visit `https://coriven.app` → sign in with your 1D account.

✅ **Phase 1 complete** (see status box above).


---

## ▶ PHASE 2 — Persistent Memory (Epic 2)

### 2A. Enable pgvector (Supabase)
Coriven stores embeddings (PrepForge does not). Either:
- **Dashboard:** Database → **Extensions** → search **`vector`** → enable, **or**
- It's enabled automatically by the Epic 2 migration (`create extension if not exists vector;`) when you `npx supabase db push`.

### 2B. OpenAI (embeddings) — 🆕 new account
1. https://platform.openai.com → **API keys** → create key.
2. Add billing (embeddings are very cheap: `text-embedding-3-small` ≈ $0.02 / 1M tokens).
3. Add to Vercel: `OPENAI_API_KEY` (secret).

### 2C. Upstash Redis (Sentinel cache) — 🆕 new account
1. https://upstash.com → sign up → **Create Database** (Redis).
2. Region: **same region as your Vercel deployment** (low latency).
3. From the database page → **REST API** section → copy the REST URL + token.
4. Add to Vercel: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (token is secret).

> The Sentinel degrades gracefully if Upstash is down (falls back to Supabase), so this is not single-point-of-failure — but it's needed for the 2b Sentinel wave.

---

## ▶ PHASE 3 — Goals & Daily Briefing (Epic 4)

### 3A. Vercel Cron + `CRON_SECRET`
- `CRON_SECRET` was set in Phase 1 — reused to authenticate cron calls.
- Cron schedules are defined in code (`vercel.json` `crons` or route config) by the implementation wave — **no dashboard step**, but see the tier note below.

### 3B. ⚠️ Vercel plan check (important)
- **Hobby** plan: cron is limited (small number of jobs, **once-daily** frequency) and is **non-commercial only**.
- A single **daily** briefing for one user fits Hobby. But:
  - **Timezone-accurate** briefings (the multi-user design) and **Epic 5's 15-min email poll / hourly calendar sync** need **sub-daily crons → Vercel Pro (~$20/mo)**.
  - **Monetizing Coriven (Epic 7) is commercial use → Vercel Pro is required** by Vercel's terms regardless.
- **Plan:** stay on Hobby through Epics 1–4 (personal, daily briefing); **upgrade to Vercel Pro when you start Epic 5** (or sooner if you want minute-accurate briefings).

---

## ▶ PHASE 4 — Communications Intelligence (Epic 5)

### 4A. Google Cloud OAuth (Gmail + Calendar) — 🆕 new project
1. https://console.cloud.google.com → **New Project** → `coriven`.
2. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen** → External → app name `Coriven`, your support email → add **your own email as a Test user** (avoids Google's full verification while it's just you).
4. **Credentials → Create credentials → OAuth client ID → Web application:**
   - Authorized redirect URI: `https://coriven.app/api/auth/google/callback` (match the route the Epic 5 wave implements; add a `http://localhost:3000/...` variant for local dev).
5. Copy **Client ID** + **Client secret**.
6. Add to Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret).

> Scopes used: Gmail read + send, Calendar read/write. Sending email / writing events still pass through Coriven's **approval queue** (zero-trust). Full Google verification is only needed if you open it beyond test users.

### 4B. Token encryption key
OAuth tokens are stored **AES-256-GCM encrypted**. Generate a 32-byte hex key and add to Vercel as `DATA_ENCRYPTION_KEY` (secret):
```bash
openssl rand -hex 32
```
> ⚠️ If you ever change this key, stored tokens become undecryptable — users must reconnect. Treat it like a password.

### 4C. n8n (optional, deferred)
Per ADR-005, Coriven **starts with direct Gmail/Calendar API calls**; n8n is a swappable worker you can add later. If/when you self-host n8n: set `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`. **Skip for now.**

---

## ▶ PHASE 6 — Productization (Epic 7)

### 6A. Stripe — ♻️ reuse MealPrepForge LLC account
Coriven bills through the **same Stripe account** as PrepForge, as a second product line.

1. **Stripe Dashboard → Products** → create three Coriven products (use **Test mode** first):
   - **Coriven Core** — recurring: $12/mo and $120/yr (two prices on one product).
   - **Coriven Pro** — recurring: $22/mo and $220/yr.
   - **Coriven Lifetime** — one-time: $199.
2. Copy each **Price ID** (`price_…`).
3. **Developers → Webhooks → Add endpoint:** URL `https://coriven.app/api/webhooks/stripe`; events: `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/payment_failed`, `checkout.session.completed`. Copy the endpoint's **Signing secret**.
4. Add to Vercel (mirrors PrepForge's naming):

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | account secret key (shared w/ PrepForge; `sk_live_…`/`sk_test_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | account publishable key (`pk_…`) |
| `STRIPE_WEBHOOK_SECRET` | **Coriven endpoint's** signing secret (per-endpoint — NOT PrepForge's) |
| `STRIPE_PRICE_CORE_MONTHLY` | `price_…` |
| `STRIPE_PRICE_CORE_ANNUAL` | `price_…` |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_…` |
| `STRIPE_PRICE_PRO_ANNUAL` | `price_…` |
| `STRIPE_PRICE_LIFETIME` | `price_…` |

> The webhook **secret is per-endpoint**, so Coriven and PrepForge each have their own. The **secret/publishable keys are account-wide** and shared. Coriven's subscriptions are distinguished by its own Products/Prices + the `user_id` metadata on checkout (same pattern PrepForge uses).

### 6B. Web Push / VAPID (PWA mobile push) — 🆕 self-generated
Generate a VAPID keypair once:
```bash
npx web-push generate-vapid-keys
```
Add to Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public), `VAPID_PRIVATE_KEY` (secret), `VAPID_SUBJECT` (`mailto:you@example.com`).

### 6C. Vercel Pro
Confirm you're on **Vercel Pro** by launch (commercial use + cron frequency — see §3B).

---

## ▶ Tauri tray distribution (only if/when the Tauri "Go" decision lands)

Deferred until wave 1.3.1's decision says Go. When it does:
- **Apple Developer Program** — $99/yr — to notarize the Mac `.app`.
- **Windows code-signing certificate** — to avoid SmartScreen warnings (OV cert ~$200–400/yr, or use a cloud-signing service).
- CI builds both artifacts. None of this is needed while the Node.js tray is in use.

---

## Master environment-variable reference

Set these in **Vercel → Project → Settings → Environment Variables** (Production; add Preview for preview deploys). Secrets must **not** use the `NEXT_PUBLIC_` prefix.

| Variable | Phase | Service | Secret |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 1 | Supabase | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 1 | Supabase | no |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 | Supabase | **yes** |
| `ANTHROPIC_API_KEY` | 1 | Anthropic | **yes** |
| `NEXT_PUBLIC_APP_URL` | 1 | app | no |
| `CRON_SECRET` | 1 (used 3+) | Vercel Cron | **yes** |
| `OPENAI_API_KEY` | 2 | OpenAI | **yes** |
| `UPSTASH_REDIS_REST_URL` | 2 | Upstash | no |
| `UPSTASH_REDIS_REST_TOKEN` | 2 | Upstash | **yes** |
| `GOOGLE_CLIENT_ID` | 5 | Google OAuth | no |
| `GOOGLE_CLIENT_SECRET` | 5 | Google OAuth | **yes** |
| `DATA_ENCRYPTION_KEY` | 5 | token encryption | **yes** |
| `N8N_WEBHOOK_URL` | 5 (opt) | n8n | no |
| `N8N_WEBHOOK_SECRET` | 5 (opt) | n8n | **yes** |
| `STRIPE_SECRET_KEY` | 7 | Stripe | **yes** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 7 | Stripe | no |
| `STRIPE_WEBHOOK_SECRET` | 7 | Stripe | **yes** |
| `STRIPE_PRICE_CORE_MONTHLY` | 7 | Stripe | no |
| `STRIPE_PRICE_CORE_ANNUAL` | 7 | Stripe | no |
| `STRIPE_PRICE_PRO_MONTHLY` | 7 | Stripe | no |
| `STRIPE_PRICE_PRO_ANNUAL` | 7 | Stripe | no |
| `STRIPE_PRICE_LIFETIME` | 7 | Stripe | no |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 7 | Web Push | no |
| `VAPID_PRIVATE_KEY` | 7 | Web Push | **yes** |
| `VAPID_SUBJECT` | 7 | Web Push | no |

A matching template lives at the repo root: **`.env.example`** (grouped by phase, with comments).

---

## Recommendations from the PrepForge comparison

These keep the two products consistent and avoid known foot-guns (apply during the relevant epic — not now):

1. **Add a `handle_new_user()` auth trigger.** PrepForge auto-creates the `profiles` row on signup (`20260513151529_auto_create_profile_on_signup.sql`); **Coriven currently has no such trigger**, so a `profiles` row only exists if created by hand. Add an equivalent migration **before Epic 7** (billing reads `profiles.subscription_tier`). I can write this migration when we reach it.
2. **Mirror Stripe env naming** (done above) so shared-account billing code reads the same way across products.
3. **Consider `@vercel/analytics`** (PrepForge uses it) for zero-config Web Vitals — optional, add in Epic 7.
4. **4-client Supabase pattern** — already matches PrepForge (`client` / `server` / `auth-server` / `auth-client`). ✅
5. **Separate API keys per product** (Anthropic, and Stripe products) for clean per-product cost attribution, even on shared accounts.

---

## Phase completion checklists

**Phase 1 (now)** — [ ] Supabase project + creds · [ ] migrations applied · [ ] owner account confirmed · [ ] Vercel project (root `apps/web`) · [ ] 6 env vars · [ ] deploy resolves to sign-in · [ ] `NEXT_PUBLIC_APP_URL` correct · [ ] prod branch `main`
**Phase 2** — [ ] pgvector enabled · [ ] `OPENAI_API_KEY` · [ ] Upstash DB + 2 vars
**Phase 3** — [ ] (decide Vercel Pro timing) · [ ] crons deploy with `CRON_SECRET`
**Phase 5** — [ ] Google Cloud project + APIs + OAuth client · [ ] `DATA_ENCRYPTION_KEY` · [ ] Vercel Pro · [ ] (n8n optional)
**Phase 7** — [ ] Stripe products/prices + webhook · [ ] price/key env vars · [ ] VAPID keys · [ ] Vercel Pro confirmed

> Troubleshooting for Phase 1 (build/env/auth issues) is in the original notes; ping me if a deploy step fails and I'll diagnose against the actual repo.
