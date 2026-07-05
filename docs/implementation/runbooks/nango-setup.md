---
title: Nango Self-Hosted Setup Runbook
wave: 5.1.1
lastupdated: "2026-07-04"
---

# Nango Self-Hosted Setup Runbook

This runbook documents every manual step required to deploy and configure the
self-hosted Nango instance that Coriven uses as its OAuth authority (ADR-013).
Agents cannot perform these steps — they require a logged-in human with access
to Railway, Google Cloud Console, and Microsoft Entra.

---

## Prerequisites

- Railway account (or equivalent managed container hosting)
- Managed Postgres service separate from Coriven's Supabase instance
- Managed Redis service (e.g. Upstash or Railway Redis add-on)
- Google Cloud project with billing enabled
- Microsoft Entra app registration access (Azure portal)
- Vercel access to Coriven's environment variables

---

## Step 1 — Vault the Nango encryption key BEFORE first deploy

> **CRITICAL: The Nango encryption key cannot be rotated after the instance first
> starts. Vault it now. If this key is compromised, you must bulk-revoke all
> connections via provider APIs and re-authenticate all users (see Compromise
> Runbook below).**

1. Generate a 32-byte hex key:
   ```bash
   openssl rand -hex 32
   ```
2. Store this value in a secrets manager (e.g. Railway secret, 1Password, AWS
   Secrets Manager). Do NOT store it in the repository or in plain text.
3. You will set this as `NANGO_ENCRYPTION_KEY` in the Nango environment on
   Railway in Step 2.

### Compromise Runbook (if encryption key is ever exposed)

If `NANGO_ENCRYPTION_KEY` is compromised:

1. Immediately revoke all OAuth app authorizations via each provider's developer
   console:
   - **Google:** console.cloud.google.com → APIs & Services → Credentials →
     OAuth 2.0 Client IDs → revoke all tokens
   - **Microsoft:** portal.azure.com → App registrations → Certificates &
     secrets → remove all secrets and rotate
2. Notify all users that they must reconnect their accounts.
3. Spin up a fresh Nango instance with a new encryption key and new external
   Postgres (the old DB's encrypted tokens are unrecoverable without the key).
4. Re-register provider OAuth apps if client credentials were also exposed.
5. Update `NANGO_SECRET_KEY`, `NANGO_HOST`, and `NANGO_ENCRYPTION_KEY` in
   Vercel and re-deploy Coriven.

---

## Step 2 — Deploy Nango on Railway

1. In Railway, create a new project.
2. Add a **Postgres** service (Railway managed or link an external Postgres URL)
   — separate from Coriven's Supabase.
3. Add a **Redis** service (Railway Redis add-on or Upstash external URL).
4. Deploy Nango using the official Docker image:
   - Image: `nangohq/nango-server:latest` (pin to a specific release tag in
     production)
   - Set the following environment variables in Railway:

   | Variable | Value |
   |---|---|
   | `NANGO_ENCRYPTION_KEY` | The 32-byte key from Step 1 |
   | `NANGO_DATABASE_URL` | Connection string for the Nango Postgres service |
   | `REDIS_URL` | Connection string for the Redis service |
   | `SERVER_RootURL` | The Railway-assigned public HTTPS URL for this service |
   | `NANGO_SECRET_KEY` | Generate a random key: `openssl rand -hex 32` — this is what Coriven's SDK uses |

5. Enable HTTPS. Railway provides it automatically for public services.
6. Set the service to restart on crash (Railway default).
7. Note the public URL — this is your `NANGO_HOST`.

### Network isolation

- In Railway, restrict the Nango service's public exposure so only Coriven's
  Vercel deployment IP ranges can reach it, or use a private networking approach
  (Railway private networking if available, or an allowlisted IP range in the
  hosting firewall).
- The Nango admin dashboard should not be publicly reachable without
  authentication. Railway provides a basic auth option or you can restrict to
  VPN/private access only.

---

## Step 3 — ELv2 license confirmation

Before the Nango instance processes any real user connections, obtain written
confirmation from Nango (support@nango.dev or their Slack community) that
Auth-only self-hosted commercial production use is permitted under Elastic
License 2.0 (ELv2).

Our usage: OAuth token management (`getToken()`, `getConnection()`) only — no
syncs, no custom scripts, no webhooks. Record Nango's response in
`docs/architecture/decisions/ADR-013-integration-token-authority.md` under the
"ELv2 confirmation" heading.

---

## Step 4 — Register Google Cloud OAuth app

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs &
   Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (Web application type).
3. Add the Nango callback URL as an authorized redirect URI:
   ```
   https://<NANGO_HOST>/oauth/callback
   ```
4. Under **OAuth consent screen**, add the following scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
5. During development, set the app to **Testing** mode and add test user email
   addresses (avoids Google verification delays).
6. Note the **Client ID** and **Client Secret** — you will enter these in Nango
   (Step 6), not in Coriven's env vars.

> **Google CASA note:** Gmail restricted scopes (`gmail.readonly`, `gmail.send`)
> require annual CASA Tier 2 assessment once the app exceeds 100 connected
> Gmail accounts. The validation phase is exempt under this threshold. Budget
> ~$1-5K/yr and 2-6 months for first-pass CASA when approaching productization.
> Consider launching `gmail.readonly` before `gmail.send` to minimize the
> injection blast radius during pilot.

---

## Step 5 — Register Microsoft Entra app

1. Go to [Azure portal](https://portal.azure.com/) → Azure Active Directory →
   App registrations → New registration.
2. **Supported account types:** "Accounts in any organizational directory (Any
   Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype,
   Xbox)" — this covers both Outlook.com and work/school accounts.
3. **Redirect URI:** Web, set to:
   ```
   https://<NANGO_HOST>/oauth/callback
   ```
4. Under **API permissions → Add a permission → Microsoft Graph**, add
   delegated permissions:
   - `Mail.Read`
   - `Mail.Send`
   - `Calendars.Read`
   - `Calendars.ReadWrite`
5. Under **Certificates & secrets**, create a new client secret. Note the value
   immediately (only shown once).
6. Note the **Application (client) ID** and the **client secret** — enter in
   Nango (Step 6).

> **Microsoft publisher verification:** Free to obtain, required to avoid the
> "unverified publisher" warning in the OAuth consent screen for most Entra
> tenants. Requires joining the Microsoft AI Cloud Partner Program and domain
> validation. Start early — it gates consent for work accounts.
>
> **Avoid:** Features that edit delivered mail or use `Mail-Advanced.ReadWrite`
> — this scope requires admin consent in all tenants and is blocked in most
> from December 2026.

---

## Step 6 — Configure provider integrations in Nango

In the Nango dashboard (Settings → Integrations → Add integration):

### Gmail integration
- **Provider:** Google (select from list)
- **Unique Key (providerConfigKey):** `google-mail`
- **Client ID / Client Secret:** from Step 4
- **Scopes:** `https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send`

### Google Calendar integration
- **Provider:** Google Calendar (select from list)
- **Unique Key (providerConfigKey):** `google-calendar`
- **Client ID / Client Secret:** from Step 4 (same Google OAuth app)
- **Scopes:** `https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events`

### Outlook Mail integration
- **Provider:** Microsoft (select from list)
- **Unique Key (providerConfigKey):** `outlook`
- **Client ID / Client Secret:** from Step 5
- **Scopes:** `Mail.Read Mail.Send offline_access`

### Outlook Calendar integration (Wave 5.4 - configure now to avoid a schema migration)
- **Provider:** Microsoft Calendar (select from list, or re-use the same Microsoft app)
- **Unique Key (providerConfigKey):** `outlook-calendar`
- **Client ID / Client Secret:** from Step 5
- **Scopes:** `Calendars.Read Calendars.ReadWrite offline_access`

> **providerConfigKey assumption:** The four keys above (`google-mail`,
> `google-calendar`, `outlook`, `outlook-calendar`) are assumed to match Nango's
> standard provider slug format. Verify them against the Nango dashboard — the
> exact keys you set here must match the `PROVIDER_CONFIG_KEYS` map in
> `apps/web/src/lib/integrations/nango.ts`. Update that map if you use different
> keys.

---

## Step 7 — Verify end-to-end OAuth connect

1. In the Nango dashboard, use the **"Connect"** button for the `google-mail`
   integration.
2. Complete the OAuth flow with a test Google account.
3. Confirm a connection appears in Nango's Connections list.
4. In the Nango dashboard terminal or via the Nango SDK, call `getToken` against
   that connection ID and confirm a non-empty access token is returned.
5. Optionally, make a test call to the Gmail API using that token to confirm it
   works end-to-end.

---

## Step 8 — Set Vercel environment variables

In Vercel (coriven project → Settings → Environment Variables), add:

| Variable | Value | Environment |
|---|---|---|
| `NANGO_SECRET_KEY` | The `NANGO_SECRET_KEY` value set in Railway Step 2 | Production, Preview |
| `NANGO_HOST` | The Railway public HTTPS URL for Nango (e.g. `https://nango.up.railway.app`) | Production, Preview |

For local development, add the same two variables to `apps/web/.env.local`
(never commit this file).

---

## Step 9 — Smoke-test Coriven → Nango path

1. Deploy Coriven to Vercel (or run locally with env vars set).
2. Insert a test row in the `integrations` table (via Supabase dashboard or
   psql) with your test user ID, provider `gmail`, and the connection ID from
   Step 7.
3. Call `getProviderToken(userId, 'gmail')` from a server action or API route.
4. Confirm a non-empty token is returned and no error is logged.

---

## Maintenance notes

- **Nango free self-hosted tier:** covers `getToken()` / `getConnection()` usage
  only. Syncs, custom scripts, and webhooks are paid features — do not enable
  them. Re-check the free tier scope every ~6 months (ADR-013).
- **Nango image updates:** pin to a specific Docker tag in Railway rather than
  `latest` to avoid unexpected breaking changes. Review Nango release notes
  before updating.
- **Token refresh:** handled transparently by Nango. No Coriven code manages
  refresh tokens directly.
- **Connection health:** Nango has no free webhook on self-hosted. Poll
  connection status via `nango.getConnection()` if needed, or surface
  `getProviderToken` returning null as "needs reconnect" in the UI (Wave 5.1.2).
