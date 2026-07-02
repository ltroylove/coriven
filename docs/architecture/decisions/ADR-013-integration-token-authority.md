# ADR-013: Integration Token Authority — Split Read/Write with Coriven as Token Authority

**Status:** Accepted  
**Date:** 2026-07-02  
**Deciders:** Roy Love  

---

## Context

Epic 5 (Communications Intelligence) requires OAuth access to external providers (Gmail, Google Calendar, Microsoft Graph/Outlook). Two consumers need these tokens:

1. **Read path** — Coriven polls for new emails/events every 15 minutes via Vercel Cron and fetches email bodies on demand. Direct provider API calls are simplest here.
2. **Write path** — Approved actions (send email, create event, post to Slack, update Airtable) need to execute against the provider. n8n handles this as the execution worker, giving access to 400+ pre-built connectors without building each integration from scratch.

Three token-sharing options were evaluated:

- **Option A — Token in webhook payload:** Coriven decrypts the token and passes it to n8n on each approved-action webhook. Simple, but token travels over the wire and may appear in n8n logs.
- **Option B — n8n holds its own token:** User authenticates twice — once in Coriven for the read path, once in n8n's credential store for the write path. Cleaner separation but poor UX and two diverging refresh cycles.
- **Option C — Coriven is the token authority:** n8n calls back to a Coriven endpoint to get a fresh access token immediately before executing each action. Coriven handles all token storage and refresh. n8n never holds credentials.

---

## Decision

**Adopted: Option C — Coriven as the single OAuth token authority.**

- The user authenticates once per provider in Coriven's `/settings/integrations` page.
- Access and refresh tokens are stored in the `integrations` table, encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY`.
- Coriven exposes a server-side token endpoint: `GET /api/integrations/token?provider=gmail` (authenticated via a shared `N8N_WEBHOOK_SECRET`).
- n8n workflows call this endpoint to obtain a current access token immediately before executing each action. The token is used once and not persisted by n8n.
- Token refresh is Coriven's responsibility. If the access token is expired, Coriven refreshes it using the stored refresh token and returns the new access token.
- The read path (email poll, calendar fetch) calls provider APIs directly using the same token store — no n8n involvement.

**Split path summary:**

| Path | Consumer | Token source | Provider call |
|------|----------|--------------|---------------|
| Read (poll/fetch) | Coriven cron/on-demand | `integrations` table (server-side) | Direct Gmail/Graph API |
| Write (approved actions) | n8n | `/api/integrations/token` callback | n8n node → provider API |

---

## Security Constraints

### Token storage
- AES-256-GCM encryption with `DATA_ENCRYPTION_KEY` (32-byte hex).
- `DATA_ENCRYPTION_KEY` must be stored in Vercel's encrypted environment variable store, not in source or `.env.local`. Rotate annually or on suspected compromise.
- Tokens are never returned to the client — decryption happens server-side only.
- Refresh tokens are never passed to n8n under any circumstances.

### Token callback endpoint (`/api/integrations/token`)
- Authenticated via `Authorization: Bearer <N8N_WEBHOOK_SECRET>` (constant-time comparison with `crypto.timingSafeEqual`).
- Returns only the access token for the specific `provider` + authenticated user combination.
- Rate-limited to prevent token harvesting if the secret is compromised.
- Logs every token issuance with provider, timestamp, and requesting IP (for audit — no token value in logs).

### OAuth scopes
- Request the minimum scope needed per provider:
  - Gmail read path: `gmail.readonly`
  - Gmail write path: `gmail.send` (not `gmail.modify`, not full access)
  - Google Calendar read: `calendar.readonly`
  - Google Calendar write: `calendar.events`
  - Microsoft Graph: equivalent minimum scopes
- Scope selection documented per provider in the integration settings UI.

### n8n hygiene
- Self-hosted n8n is strongly preferred over n8n Cloud — keeps token callback traffic on controlled infrastructure.
- Disable payload logging in n8n for all workflows that call `/api/integrations/token` or handle email/calendar data.
- n8n webhook URLs must be authenticated (n8n validates `X-Webhook-Secret` on inbound calls from Coriven's approval queue).

### Prompt injection
- Email bodies and calendar event descriptions are untrusted content. They are never passed to Claude as instructions — only as summarization input with an explicit hostile-content framing in the system prompt (§9.3 of the blueprint).
- The triage step processes metadata only. Body content is fetched on demand and always sandboxed.

---

## Consequences

**Positive:**
- Single OAuth consent flow per provider — no double-authentication UX.
- Single refresh path — no diverging token state between Coriven and n8n.
- Refresh tokens never leave Coriven's encrypted store.
- n8n gains access to 400+ connectors for the write path without Coriven building each integration.
- Blast radius of a compromised access token is bounded by OAuth scope (read-only tokens cannot send).

**Negative:**
- Each n8n action execution requires an extra round-trip to `/api/integrations/token` before calling the provider.
- If Coriven is down, n8n cannot execute approved actions (token callback fails). Mitigation: n8n can retry on a short backoff; the approval queue preserves the intent.
- `DATA_ENCRYPTION_KEY` is a single point of failure for all stored tokens — key management discipline is critical.

---

## Related
- ADR-009: Approval Queue Audit Gate (defines the approved-action flow that triggers n8n)
- Blueprint §11 (Communications Intelligence), §17.4 (Phase 4), §20 (env vars)
