# ADR-013: Integration Platform Architecture — Nango + Direct Provider APIs

**Status:** Accepted  
**Date:** 2026-07-02 (revised 2026-07-04 after external research validation)  
**Deciders:** Roy Love  
**Supersedes:** v1 draft (n8n as write-path worker), v2 draft (Zapier Embed as long-tail layer)

---

## Context

Coriven's vision is to connect as much of a user's life as possible — email, calendar, and eventually fitness trackers, banking, smart home, Slack, Notion, and whatever each user's life runs on. Two categories of integrations exist with different access patterns:

- **Deep integrations** (Gmail, Outlook, Google Calendar) — Coriven reads these continuously (15-min poll), queries them on demand for meeting prep and triage, and writes back via approved actions. Direct API access is required for query flexibility.
- **Long-tail integrations** (everything else) — Coriven triggers actions and receives events but doesn't need complex query access.

Earlier drafts of this ADR proposed n8n (v1) and then Zapier Embed (v2) as the long-tail execution layer. External research (2026-07-03, three parallel research reports) invalidated both and validated the rest of the architecture:

1. **n8n is single-tenant by design** — one instance per user doesn't scale; n8n Embed is enterprise-priced (~$50K/yr).
2. **Zapier Embed shifts cost to the user** — every end user needs their own Zapier account; the free tier caps at 100 tasks/month with two-step Zaps, so an active Coriven user would need a paid Zapier plan (~$20+/mo) on top of Coriven's $12–22/mo subscription. There is no partner-absorbs-cost mode. This kills conversion for a consumer product.
3. **The consumer-viable alternatives carry fresh risk** — Composio (purpose-built for AI-agent actions, ~$0.30/1K actions) suffered a May 2026 breach leaking OAuth tokens including Gmail tokens; Pipedream Connect was acquired by Workday, creating roadmap risk for consumer use cases.
4. **The market converged on MCP-shaped tool calling** as the substrate for "AI executes actions in a user's apps" (Zapier MCP, Composio MCP, Pipedream MCP) — meaning a well-abstracted action interface makes the eventual vendor swappable.

---

## Decision

**Two layers now; long-tail connectors deferred to a dedicated post-validation epic.**

### Layer 1 — Nango (OAuth authority, self-hosted)
[Nango](https://www.nango.dev/) is a source-available (Elastic License 2.0), multi-tenant OAuth and API credential management platform. It handles the "connect your account" flow and manages token storage, refresh, and rotation. Coriven never stores raw OAuth tokens.

- All provider OAuth flows run through self-hosted Nango. Our usage (Auth + `getToken()`) falls within the free self-hosted tier — syncs/functions/webhooks are the paid features we don't use.
- Coriven's `integrations` table stores `nango_connection_id` and `provider` per user — no raw tokens, no `DATA_ENCRYPTION_KEY` to manage.
- Server-side code calls `nango.getToken(providerConfigKey, connectionId)` per request; Nango handles refresh transparently.
- Self-hosting (vs. Nango Cloud) is deliberate: it keeps the Gmail data path inside our own Google CASA assessment boundary, avoids Google's rejection of `api.nango.dev` callback URLs, and avoids ~$1/connection/month Cloud pricing (~$3/user/mo at 3 connections).

### Layer 2 — Direct provider API calls (Gmail, Outlook, Google Calendar)
- **Read path:** Vercel Cron → `nango.getToken()` → provider API → metadata stored in `email_metadata` / `calendar_events`. Bodies fetched on demand only.
- **Write path (approved actions):** approval queue → `nango.getToken()` → provider API → `audit_log`.

### Layer 3 — Long-tail connectors: DEFERRED (not in Epic 5)
Cut from Epic 5 entirely. Ship email/calendar only for the validation phase; decide the long-tail layer as its own epic after real user feedback shows which apps people actually want. Constraints recorded now for that future epic:

- **Design the action layer against an MCP-shaped internal interface** so the vendor is swappable — the entire market (Zapier, Composio, Pipedream, Paragon) has converged on MCP.
- **Candidate vendors:** Composio (best pricing fit, purpose-built for AI agents — require post-incident security attestations after their May 2026 breach before connecting anything) and Pipedream Connect (confirm per-end-user pricing and Workday roadmap commitment). Zapier Embed is ruled out as a primary layer (user-pays economics) but may return as an optional bring-your-own power-user add-on.
- **Banking goes through a dedicated aggregator (Plaid/Teller) regardless** — never through a general-purpose iPaaS.
- The approval queue's execution router (Epic 5, Feature 5.3) should keep a clean provider-routing seam so the long-tail path can be added without rework.

**Architecture summary (Epic 5 scope):**

```
User connects provider (Gmail / Outlook / Google Calendar)
        │
        ▼
   Self-hosted Nango OAuth flow
        │
        ├── Read path: Coriven cron → nango.getToken() → provider API → DB (metadata only)
        └── Write path: approval queue → nango.getToken() → provider API → audit_log
```

---

## Security Constraints

Validated and extended by external security research (2026-07-03). The 2025 incident record — **ShadowLeak** (zero-click Gmail exfiltration via ChatGPT's agent, hidden instructions in email HTML) and **EchoLeak** (CVE-2025-32711, same pattern against Microsoft 365 Copilot, bypassed their dedicated injection classifier) — is precisely Coriven's threat model and confirms that detection alone fails. The effective defense is restricting what the agent can do: capability restriction + egress control + human approval. RFC 9700 (OAuth 2.0 Security BCP, Jan 2025) is the normative reference for token handling.

### Nango deployment
- Self-hosted with **external Postgres + Redis** (bundled containers use transient storage — not production-safe). Use a separate database, not co-mingled with Coriven's Supabase.
- **The Nango encryption key cannot be rotated after first deploy** — vault it before setup; the compromise-response plan is "revoke and re-auth all users," documented as a runbook.
- Get written confirmation from Nango that Auth-only self-hosted commercial production use is permitted under ELv2; record the answer in this ADR.
- No webhooks on free self-hosted — poll connection status and handle `getToken()` failures gracefully.
- Network-isolate the Nango instance; only Coriven's server-side code can reach it.

### OAuth scopes and provider verification
- Minimum scopes: Gmail read `gmail.readonly`, write `gmail.send`; Google Calendar `calendar.readonly` / `calendar.events`; Microsoft Graph equivalents.
- **Google CASA:** restricted Gmail scopes require annual CASA Tier 2 assessment (~$1–5K/yr recurring, 2–6 months first pass) — **exempt under 100 Gmail accounts**, so the validation phase ships without it. Budget it for productization and start verification early.
- **Consider launching `gmail.readonly` before `gmail.send`** — smaller injection blast radius during the pilot; each restricted scope is in-scope for the same CASA anyway.
- **Microsoft:** free publisher verification (requires Microsoft AI Cloud Partner Program + domain validation) — get it early; it gates consent in most Entra tenants. No CASA equivalent. Avoid features editing delivered mail (new `Mail-Advanced.ReadWrite` admin-consent wall from Dec 2026).

### Approval queue hardening (binding on Epic 5 Feature 5.3)
- **The approval UI must show raw action payloads** — exact recipient, subject, full body, URLs — never only an LLM-generated summary. The summary is model output and can itself be injection-influenced ("approved on false pretenses" hole).
- **Egress allowlist:** strip or neutralize URLs and images in model output rendered to users or sent externally unless allowlisted — both 2025 incidents exfiltrated via URLs/auto-fetched resources, not via "actions."
- Three-tier action model (industry norm): auto-allow safe reads → notify on recoverable actions → block-until-approved for irreversible/external side effects. Tier to avoid approval fatigue — gate external writes, not reads.
- Execution-time constraint check (Epic 3 gate) **fails closed** for external actions.

### Prompt injection
- All external content (email bodies, calendar descriptions, API responses) is untrusted — summarization input only, never instructions, with explicit hostile-content framing (blueprint §9.3).
- The "lethal trifecta" model (private data access + untrusted content + external communication) is broken at the third leg by the approval queue — this is the single strongest control and must never be bypassed.
- Medium-term: provenance separation (structurally tag email-derived content; restrict tool calls after untrusted ingestion — lightweight plan-then-execute). Pilot on the summarization path first.

### Audit trail
- `audit_log` is append-only, service-role writes only. Every execution records: `user_id`, `provider`, `action_type`, `approval_id`, `status`, `error_code`, timestamps — no token values, no raw response bodies.
- Record the delegation chain (user → Coriven → provider connection) per action — the shape all emerging IETF agent-auth drafts assume.

---

## Consequences

**Positive:**
- Multi-tenant from day one; no raw tokens in Coriven's DB; no encryption key of our own to manage.
- Epic 5 scope shrinks — email/calendar validation ships sooner without long-tail connector work.
- Long-tail vendor decision is made later with real usage data (which apps users actually want) and Composio's post-incident track record visible.
- Self-hosted Nango simplifies Google CASA and avoids per-connection Cloud fees.
- The approval queue is validated by the 2025 incident record as the industry-standard defense.

**Negative:**
- "Connect all of life" is deferred — Epic 5 delivers email/calendar only.
- Self-hosted Nango adds an infrastructure component (Nango + external Postgres + Redis) to operate.
- Nango is a seed-stage company under a source-available license whose free self-hosted tier has been narrowing — mitigated because our blast radius is small: tokens live in our own Postgres, and the `getToken()` wrapper is a thin interface swappable for self-rolled refresh logic (Arctic et al.). Re-check the free tier's scope every ~6 months.
- CASA is an unavoidable recurring cost once Gmail access exceeds 100 users — now in the productization budget.

---

## Research Provenance
Three parallel research reports (2026-07-03): Nango viability/security, embedded-iPaaS landscape and consumer pricing, OAuth/AI-agent security best practices. Key sources: RFC 9700; Google restricted-scope verification docs; EchoLeak (CVE-2025-32711) and ShadowLeak disclosures; Google's layered-defense guidance (June 2025); Zapier/Composio/Pipedream pricing pages; Nango docs and repo; Composio May 2026 incident disclosure.

## Related
- ADR-009: Approval Queue Audit Gate (defines the approved-action flow)
- Blueprint §9 (zero-trust spine), §11 (Communications Intelligence), §17.4 (Phase 4)
