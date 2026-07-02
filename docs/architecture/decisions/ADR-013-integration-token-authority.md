# ADR-013: Integration Platform Architecture — Nango + Direct APIs + Zapier Embed

**Status:** Accepted  
**Date:** 2026-07-02  
**Deciders:** Roy Love  
**Supersedes:** Initial draft (n8n as write-path worker, Coriven as custom token authority)

---

## Context

Coriven's vision is to connect as much of a user's life as possible — not just email and calendar, but fitness trackers, banking, smart home, Slack, Notion, and whatever each individual user's life runs on. This is fundamentally an integration platform problem, not just an email reader problem.

The initial approach (Coriven as a custom OAuth token authority, n8n as the write-path worker) was designed around email/calendar only and has three problems at product scale:

1. **n8n is single-tenant by design.** One n8n instance per user is operationally nightmarish; n8n Embed is enterprise-priced ($1k+/mo custom contract). It cannot serve as the foundation for a multi-user product.
2. **Custom token management doesn't scale across providers.** Building and maintaining OAuth flows, token refresh, and scope management for every provider Coriven supports is unbounded ongoing engineering work.
3. **The approval queue needs a multi-tenant execution layer.** Approved actions need to execute against the right user's credentials, across any provider, without cross-user token leakage.

Two categories of integrations exist with different access patterns:

- **Deep integrations** (Gmail, Outlook, Google Calendar) — Coriven reads these continuously (15-min poll), queries them on demand for meeting prep and triage, and writes back via approved actions. Direct API access is required for query flexibility.
- **Long-tail integrations** (fitness, banking, smart home, Slack, Notion, Airtable, HubSpot, and anything else a user's life touches) — Coriven triggers actions and receives events but doesn't need complex query access. A workflow/trigger model covers the need.

---

## Decision

**Three-layer integration architecture:**

### Layer 1 — Nango (OAuth authority for all providers)
[Nango](https://www.nango.dev/) is an open-source, multi-tenant OAuth and API credential management platform. It handles the "connect your account" flow for 200+ providers and manages token storage, refresh, and rotation natively. Coriven never stores raw OAuth tokens — Nango owns that layer.

- All provider OAuth flows (Google, Microsoft, Slack, GitHub, Fitbit, Plaid, etc.) run through Nango.
- Nango is self-hosted (or Nango Cloud) and is multi-tenant from day one — each Coriven user has isolated credentials within the same Nango instance.
- Coriven calls Nango's server-side SDK (`nango.getToken(providerConfigKey, connectionId)`) to get a fresh access token whenever it needs to call a provider API. Nango handles refresh transparently.
- The `integrations` table in Coriven's DB stores `nango_connection_id` and `provider` per user — no raw tokens, no encryption key to manage.

### Layer 2 — Direct API calls (deep integrations: Gmail, Outlook, Google Calendar)
For providers Coriven queries deeply and continuously, it calls provider APIs directly using tokens retrieved from Nango:

- **Read path:** Vercel Cron calls provider API → stores metadata in `email_metadata` / `calendar_events`. Bodies fetched on demand only.
- **Write path (approved actions):** Coriven server action fetches token from Nango → calls provider API directly → logs to `audit_log`.
- Providers in scope for direct integration: Gmail, Microsoft Graph (Outlook + Outlook Calendar), Google Calendar.

### Layer 3 — Zapier Embed (long-tail connectors)
For everything else a user's life runs on, [Zapier Embed](https://zapier.com/l/embed) provides a white-labeled "connect your apps" UI and 6,000+ app connectors baked into Coriven's settings page. When an approved action targets a long-tail provider, Coriven fires a Zapier webhook; Zapier executes the action using the user's connected credentials (which Zapier manages).

- Users connect long-tail apps inside Coriven's UI via Zapier Embed — no separate Zapier account required.
- Coriven's approval queue fires a typed webhook payload to Zapier on approval.
- Zapier's consumption-based per-user pricing maps cleanly to Coriven's subscription tiers.
- Coriven does not store credentials for long-tail providers — Zapier owns that.

**Architecture summary:**

```
User connects provider
        │
        ▼
   Nango OAuth flow (all providers)
        │
        ├── Deep providers (Gmail, Outlook, Calendar)
        │       │
        │       ├── Read path: Coriven cron → Nango.getToken() → provider API → DB
        │       └── Write path: approved action → Nango.getToken() → provider API → audit_log
        │
        └── Long-tail providers (everything else)
                │
                └── Approved action → Zapier webhook → Zapier executes → audit_log
```

**Data flow for an approved action:**

1. Claude drafts action → `submit_for_approval` → lands in `approval_queue`
2. User reviews at `/approvals` → approves
3. Coriven reads `approval_queue.action_type` + `provider`
4. If deep provider: fetch token from Nango → call provider API directly
5. If long-tail provider: POST typed webhook to Zapier Embed endpoint → Zapier executes
6. Both paths write result to `audit_log`; `approval_queue.status` → `executed`

---

## Security Constraints

### Nango
- Self-hosted Nango is preferred for Phase 4 validation — Coriven controls the token store.
- Nango Cloud is acceptable for early validation but review their data residency and encryption guarantees before productization.
- `nango_connection_id` values in Coriven's DB are not sensitive on their own — they only resolve to tokens within Nango's authenticated API. Treat them as opaque identifiers, not secrets.
- Nango enforces per-connection isolation — one user's token cannot be retrieved with another user's `connectionId`.

### OAuth scopes
- Request minimum scopes per provider at connection time:
  - Gmail read: `gmail.readonly` — write: `gmail.send`
  - Google Calendar read: `calendar.readonly` — write: `calendar.events`
  - Microsoft Graph: equivalent minimum scopes per operation
- Scope selection surfaced to the user at connection time in `/settings/integrations`.

### Zapier Embed
- Zapier webhook URLs are authenticated (`X-Webhook-Secret` header, constant-time comparison).
- Webhook payloads contain only the action parameters (recipient, subject, body, etc.) — never raw tokens or PII beyond what the action requires.
- Zapier manages credentials for long-tail providers; Coriven has no visibility into those tokens.

### Prompt injection
- Email bodies, calendar descriptions, and any content fetched from external providers are untrusted. Never passed to Claude as instructions — only as sandboxed summarization input with an explicit hostile-content framing in the system prompt (§9.3 of the blueprint).
- Triage processes metadata only. Body content fetched on demand with the hostile-content frame applied before any Claude call.

### Audit trail
- Every approved action execution (regardless of path) writes to `audit_log` with: `user_id`, `provider`, `action_type`, `approved_at`, `executed_at`, `status`, `error_code` (no token values, no raw response bodies).

---

## Consequences

**Positive:**
- Multi-tenant from day one — Nango handles per-user credential isolation natively.
- No raw OAuth tokens in Coriven's database — eliminates the `DATA_ENCRYPTION_KEY` single-point-of-failure.
- 6,000+ long-tail connectors via Zapier Embed without writing integration code.
- Direct API access for deep integrations preserves query flexibility (complex filters, on-demand fetches, 15-min polling).
- Coriven's subscription pricing can incorporate Zapier's per-user consumption cost cleanly.
- Clear ownership boundaries: Nango owns OAuth, Zapier owns long-tail execution, Coriven owns the approval UI and audit trail.

**Negative:**
- Three external dependencies in the integration layer (Nango, provider APIs, Zapier) vs. one (n8n).
- Zapier Embed pricing needs validation — per-user task consumption at scale needs to fit the subscription tier margins.
- Self-hosted Nango adds an infrastructure component to operate alongside Coriven and Supabase.
- Long-tail actions are less observable than direct API calls — Zapier's execution logs are in Zapier, not Coriven's `audit_log` (mitigated by Zapier's webhook response payload confirming execution).

---

## Open Questions for Epic 5 Design

1. **Nango self-hosted vs. Nango Cloud for validation phase** — self-hosted adds ops overhead but keeps tokens on controlled infrastructure. Decide before Epic 5 implementation starts.
2. **Zapier Embed pricing tiers** — confirm per-task cost fits within Coriven's subscription margins at projected user volume.
3. **Fallback for Zapier outages** — approved actions that fail Zapier execution need a retry/notification path. Queue the action for manual retry or surface in `/approvals` as failed.

---

## Related
- ADR-009: Approval Queue Audit Gate (defines the approved-action flow)
- Blueprint §11 (Communications Intelligence), §17.4 (Phase 4), §20 (env vars)
