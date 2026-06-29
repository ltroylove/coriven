---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.1"
wave: "5.1.1"
agents: []
tags: [coriven, oauth, encryption, integrations, gmail, google-calendar, security]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.1.1: Integrations & Encrypted Tokens

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 5.1.1 |
| Feature | 5.1 — Integrations & Encrypted Tokens |
| Epic | 5 — Communications Intelligence |
| Status | Planning |
| Scope | OAuth connect/disconnect flows for Gmail and Google Calendar; AES-256-GCM encryption of access and refresh tokens at rest; server-side-only decryption; token refresh on expiry; `integrations` table with RLS; Settings UI for connecting/disconnecting providers. |
| Wave Goal | A user can connect Gmail and Google Calendar via OAuth; tokens are stored AES-256-GCM encrypted (never visible to the client); the system silently refreshes expired tokens; the user can disconnect at any time with tokens deleted. |

**Wave Philosophy:** Security before functionality — the encrypted token store and refresh flow must be correct and tested before any triage or sync wave attempts to use credentials.

## Wave Goals

1. OAuth connect/callback for Gmail and Google Calendar is functional end-to-end; connected state is visible in Settings, with `integrations` rows created with AES-256-GCM encrypted tokens (satisfying Business Requirements UC-17, UC-35).
2. Token decryption is server-side only — no `access_token` or `refresh_token` in plaintext ever reaches an API response or client component; a security unit test asserts this invariant (Architecture §"Data Protection").
3. Token refresh runs automatically before expiry; a failed refresh marks the integration `needs_reauth`, surfacing a reconnect prompt in the UI (Business Requirements UC-35).

## User Stories

---

### Story 5.1.1.1 — Connect Gmail via OAuth

**As the** owner,
**I want** to connect my Gmail account via OAuth in Settings,
**So that** Coriven can poll my email on my behalf without me sharing my password.

**Reference:** Business Requirements Integration Requirements (Gmail); UC-17.

**Priority:** Critical
**Estimated hours:** 16

**Acceptance Criteria:**
- A "Connect Gmail" button in Settings > Integrations initiates the Google OAuth consent flow with scopes limited to `gmail.readonly` and `gmail.send`.
- After successful authorization, an `integrations` row is created with `provider = 'gmail'`, `user_id`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, and `scopes`; no plaintext token is present in the row or any API response.
- The Settings UI shows provider as "connected" with the linked email address and a "Disconnect" action.
- A "Disconnect" action deletes the row and revokes the token with Google.
- The OAuth callback validates the `state` parameter to prevent CSRF.
- All `DATA_ENCRYPTION_KEY` reads come from the server environment; the key is never logged or returned to the client.

#### Task 5.1.1.1.1 — `integrations` Table Migration

| Field | Value |
|---|---|
| Parent Story | 5.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | None (Epic 1 schema in place) |
| Deliverables | `supabase/migrations/<timestamp>_add_integrations_table.sql` |

**Acceptance Criteria:**
- Migration creates `integration_provider` enum (`gmail`, `google_calendar`); `integrations` table with `id`, `user_id` (FK auth.users CASCADE), `provider`, `access_token_encrypted` (text), `refresh_token_encrypted` (text), `expires_at` (timestamptz), `scopes` (text[]), `email` (text), `status` (`active` | `needs_reauth`), `created_at`, `updated_at`.
- RLS: `SELECT/UPDATE/DELETE` policy `USING (user_id = auth.uid())`; `INSERT` via service-role only (OAuth callback runs server-side).
- Unique constraint on `(user_id, provider)`.
- TypeScript types regenerated to `apps/web/src/types/supabase.ts`.

#### Task 5.1.1.1.2 — AES-256-GCM Encryption Service

| Field | Value |
|---|---|
| Parent Story | 5.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Task 5.1.1.1.1 |
| Deliverables | `apps/web/src/lib/crypto/tokens.ts` — `encrypt(plaintext)` / `decrypt(ciphertext)` using Node.js `crypto` module; `DATA_ENCRYPTION_KEY` read from `process.env` only |

**Acceptance Criteria:**
- `encrypt` produces a base64 string containing IV + auth tag + ciphertext; `decrypt` reverses it.
- If `DATA_ENCRYPTION_KEY` is absent or not 32 bytes (hex), the function throws at call time — never silently degrades.
- Unit tests cover: round-trip correctness; distinct IV per call; error on bad key; error on tampered ciphertext.
- The module has no `export` of the raw key; no key material appears in logs or error messages.

#### Task 5.1.1.1.3 — OAuth Connect/Callback API Routes (Gmail)

| Field | Value |
|---|---|
| Parent Story | 5.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.1.1.1.1, 5.1.1.1.2 |
| Deliverables | `apps/web/src/app/api/integrations/gmail/connect/route.ts`; `apps/web/src/app/api/integrations/gmail/callback/route.ts` |

**Acceptance Criteria:**
- `/api/integrations/gmail/connect` (GET, authenticated) generates a Google OAuth URL with `state` (CSRF token stored in a short-lived cookie) and `access_type=offline`, and redirects the user.
- `/api/integrations/gmail/callback` (GET, authenticated) validates `state`, exchanges the code for tokens, encrypts both tokens via the crypto service, upserts the `integrations` row using the service-role client, and redirects to `/settings/integrations?connected=gmail`.
- The callback never returns token values in the response body or headers.
- On error (invalid state, token exchange failure), redirects to `/settings/integrations?error=<reason>` and logs the error server-side.
- `CRON_SECRET` is not used here; the routes require a valid Supabase session (authenticated via `auth-server` client).

---

### Story 5.1.1.2 — Connect Google Calendar via OAuth

**As the** owner,
**I want** to connect my Google Calendar account via OAuth,
**So that** Coriven can read and (with my approval) write calendar events.

**Reference:** Business Requirements Integration Requirements (Google Calendar); UC-17.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- A "Connect Calendar" button in Settings > Integrations initiates OAuth with scopes `calendar.readonly` and `calendar.events` (write scope, for approved writes).
- Calendar OAuth reuses the same `integrations` table with `provider = 'google_calendar'`; encrypted tokens stored identically to Gmail.
- Connect/disconnect flows mirror Gmail (Story 5.1.1.1); implementation shares the crypto service and a generic OAuth helper.
- Disconnect removes the `google_calendar` row without affecting Gmail integration.

#### Task 5.1.1.2.1 — OAuth Connect/Callback API Routes (Google Calendar)

| Field | Value |
|---|---|
| Parent Story | 5.1.1.2 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Tasks 5.1.1.1.1, 5.1.1.1.2, 5.1.1.1.3 (shares helper) |
| Deliverables | `apps/web/src/app/api/integrations/calendar/connect/route.ts`; `apps/web/src/app/api/integrations/calendar/callback/route.ts`; shared `apps/web/src/lib/integrations/oauth-helper.ts` |

**Acceptance Criteria:**
- `oauth-helper.ts` is a provider-agnostic utility; Gmail and Calendar routes compose it with their respective scopes and provider strings.
- Calendar callback stores `provider = 'google_calendar'` and the correct scopes.
- All invariants from Task 5.1.1.1.3 apply (no plaintext tokens in responses, state CSRF validation, error redirect).

---

### Story 5.1.1.3 — Automatic Token Refresh

**As the** system,
**I want** to refresh OAuth tokens before they expire,
**So that** email polling and calendar sync never fail with auth errors due to stale credentials.

**Reference:** Business Requirements UC-35; Architecture §"Integration Architecture."

**Priority:** High
**Estimated hours:** 10

**Acceptance Criteria:**
- A `refreshIntegrationToken(userId, provider)` server-side function checks `expires_at`; if within 5 minutes of expiry, it calls Google's token endpoint, encrypts the new tokens, and updates the `integrations` row.
- On refresh failure (invalid grant, network error), the row's `status` is set to `needs_reauth` and the event is logged with structured metadata (no token values in the log).
- A `needs_reauth` status surfaces a reconnect banner in Settings > Integrations.
- The refresh function is idempotent; concurrent calls for the same provider do not double-refresh.
- Unit tests cover: happy-path refresh; skip when not near expiry; `needs_reauth` on refresh failure; idempotency guard.

#### Task 5.1.1.3.1 — Token Refresh Service

| Field | Value |
|---|---|
| Parent Story | 5.1.1.3 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Tasks 5.1.1.1.1, 5.1.1.1.2 |
| Deliverables | `apps/web/src/lib/integrations/token-refresh.ts` |

**Acceptance Criteria:**
- Exported function `ensureFreshToken(userId, provider)` returns the decrypted access token, refreshing first if needed.
- Uses service-role client for DB writes; decrypted token never stored in a variable beyond the immediate caller's scope.
- Error boundary: refresh errors throw a typed `IntegrationAuthError`; callers (cron jobs) catch and set `needs_reauth` status.

#### Task 5.1.1.3.2 — Reconnect Prompt UI

| Field | Value |
|---|---|
| Parent Story | 5.1.1.3 |
| Agent | Frontend Engineer |
| Estimation | 4h |
| Dependencies | Task 5.1.1.3.1; Settings Integrations page (Story 5.1.1.4) |
| Deliverables | Banner component in `apps/web/src/app/settings/integrations/page.tsx` |

**Acceptance Criteria:**
- When `integrations.status = 'needs_reauth'`, a dismissible warning banner renders above the provider row: "Gmail connection expired — Reconnect."
- The banner links back to the connect flow; dismissal does not change the DB row (it will reappear on next load until reconnected).
- WCAG AA: banner has `role="alert"`, sufficient contrast, and is keyboard-reachable.

---

### Story 5.1.1.4 — Settings > Integrations UI

**As the** owner,
**I want** a Settings > Integrations page that shows connection status for each provider,
**So that** I can connect, verify, and disconnect integrations from one place.

**Reference:** Business Requirements UC-17; UX Doc §"Settings" + §"Approvals (Phase 4)."

**Priority:** High
**Estimated hours:** 8

**Acceptance Criteria:**
- `/settings/integrations` lists Gmail and Google Calendar; each shows: provider name, connected email (if linked), status badge (Connected / Disconnected / Needs Reauth), and Connect/Disconnect action.
- Connected state is fetched server-side (no plaintext token is present in the page payload).
- Disconnect action calls a Server Action that deletes the `integrations` row and revokes with Google; the UI optimistically updates.
- Page is keyboard-navigable; status badges have accessible labels; focus is not trapped.

#### Task 5.1.1.4.1 — Integrations Page and Server Actions

| Field | Value |
|---|---|
| Parent Story | 5.1.1.4 |
| Agent | Full-Stack Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.1.1.1.3, 5.1.1.2.1 |
| Deliverables | `apps/web/src/app/settings/integrations/page.tsx`; `apps/web/src/app/actions/integrations.ts` (`disconnectIntegration` Server Action) |

**Acceptance Criteria:**
- `disconnectIntegration(provider)` Server Action: validates authenticated session; deletes the `integrations` row via service-role client; calls Google token revocation endpoint; revalidates the page path.
- Page reads integration rows from the auth-server client (RLS-enforced); never exposes encrypted token fields.
- Success/error toasts on connect redirect query params (`?connected=gmail`, `?error=...`).

---

## Task Dependencies

```
5.1.1.1.1 (migration)
  └─> 5.1.1.1.2 (crypto service)
        ├─> 5.1.1.1.3 (Gmail OAuth routes)
        │     └─> 5.1.1.4.1 (Settings page + disconnect action)
        └─> 5.1.1.2.1 (Calendar OAuth routes, shares helper from 5.1.1.1.3)
              └─> 5.1.1.4.1

5.1.1.1.1, 5.1.1.1.2
  └─> 5.1.1.3.1 (token refresh service)
        └─> 5.1.1.3.2 (reconnect prompt UI — depends on 5.1.1.4.1 page existing)
```

Critical path: migration → crypto service → OAuth routes → Settings UI.
Parallel streams: Gmail and Calendar OAuth routes can be developed in parallel once the crypto service and shared helper exist.

## Definition of Done

- `integrations` table migration applied and types regenerated.
- Gmail and Google Calendar OAuth connect/disconnect flows work end-to-end in production.
- AES-256-GCM encryption unit tests pass; a dedicated test asserts no decrypted token value appears in any HTTP response from the callback or integrations API routes.
- Token refresh service tested (unit); `needs_reauth` status set on refresh failure.
- Settings > Integrations page shows accurate status; reconnect banner renders when `status = 'needs_reauth'`.
- All env vars (`DATA_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`) documented in `.env.example`; none hardcoded.
- WCAG AA: integrations page keyboard-navigable; status badges labeled; alert role on error banner.
- Security review checklist item satisfied: no token in client payload, no token in logs, state CSRF validated.

## Infrastructure Specifications

### Database

**Tables:**

- `integrations` — `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `provider integration_provider NOT NULL`, `access_token_encrypted text NOT NULL`, `refresh_token_encrypted text NOT NULL`, `expires_at timestamptz NOT NULL`, `scopes text[] NOT NULL DEFAULT '{}'`, `email text`, `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reauth'))`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`.

**Enums:**

- `integration_provider`: `gmail`, `google_calendar` (extensible — Outlook etc. allowed by enum, not implemented).

**RLS Policies:**

- `SELECT/UPDATE/DELETE`: `USING (user_id = auth.uid())`.
- `INSERT`: service-role only (no client-side direct insert).
- No `DELETE` policy needed for `audit_log` (not in this wave) — established in Wave 5.3.1.

**Migration:** `supabase/migrations/<timestamp>_add_integrations_table.sql`

### API

| Method | Path | Auth | Purpose | Key Validation |
|---|---|---|---|---|
| GET | `/api/integrations/gmail/connect` | Session (auth-server) | Redirect to Google OAuth | Authenticated user; generate CSRF state |
| GET | `/api/integrations/gmail/callback` | Session (auth-server) | Exchange code, store encrypted tokens | Validate state cookie; code present |
| GET | `/api/integrations/calendar/connect` | Session (auth-server) | Redirect to Google OAuth | Same as Gmail |
| GET | `/api/integrations/calendar/callback` | Session (auth-server) | Exchange code, store encrypted tokens | Same as Gmail |
| Server Action | `disconnectIntegration(provider)` | Session (auth-server) | Delete row, revoke Google token | Authenticated; valid provider enum |

**Errors:** 401 if unauthenticated; redirect to `/settings/integrations?error=<reason>` on OAuth failure; structured server log on any crypto or network error (no token values logged).

### UI

- `/settings/integrations` (page): provider list, status badges, Connect/Disconnect buttons, `needs_reauth` alert banner.
- Props/state: server component reads integration rows (status, email only — no tokens); client components handle optimistic disconnect.
- Accessibility: `role="alert"` on error/reauth banner; `aria-label` on Connect/Disconnect buttons with provider name; visible focus ring; `prefers-reduced-motion` respected on status badge transitions.

### Testing

- **Unit:** `tokens.ts` crypto service (round-trip, distinct IV, bad key, tampered ciphertext); `token-refresh.ts` (happy path, skip when fresh, `needs_reauth` on failure, idempotency).
- **Integration:** Gmail and Calendar callback routes with mocked Google token endpoint; assert no plaintext token in response body or headers; assert `integrations` row encrypted fields are non-empty opaque strings.
- **Zero-trust token test:** assert that calling `/api/integrations/gmail/callback` with a valid exchange results in a response with no field named `access_token`, `refresh_token`, or containing the raw token string.
- **E2E:** connect Gmail → Settings shows "Connected" → disconnect → Settings shows "Disconnected" (using a Google test account; can be skipped in CI with a mock).
- **Coverage target:** >85% on `tokens.ts` and `token-refresh.ts`.

### Deployment

**Environment variables required (add to `.env.example`):**

- `DATA_ENCRYPTION_KEY` — 32-byte hex string (AES-256-GCM key); generate with `openssl rand -hex 32`; never committed; server-only.
- `GOOGLE_CLIENT_ID` — OAuth 2.0 client ID.
- `GOOGLE_CLIENT_SECRET` — OAuth 2.0 client secret; server-only.
- `NEXT_PUBLIC_APP_URL` — canonical app URL for OAuth redirect URI construction.

**OAuth app config note:** The Google Cloud project must list `${NEXT_PUBLIC_APP_URL}/api/integrations/gmail/callback` and `/api/integrations/calendar/callback` as authorized redirect URIs. Verification with Google may take days — start the review request before building Wave 5.2.

### Monitoring

- Log integration connect/disconnect events (user_id, provider, outcome) — no token values.
- Alert on repeated `needs_reauth` status transitions (may indicate refresh endpoint instability).
- Track: connect success rate per provider; refresh failure rate.

## Handoff Requirements

- `integrations` table migration applied and reviewed.
- `.env.example` updated with all four new vars.
- Google Cloud OAuth app configured with correct redirect URIs.
- Token encryption unit tests passing in CI.
- Wave 5.2 (Email Triage) may begin only after `ensureFreshToken` is functional and tested.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Google OAuth app verification delay | High | Medium | Start Google verification request immediately; test with unverified app on test accounts while waiting |
| `DATA_ENCRYPTION_KEY` misconfiguration (wrong length, missing) | High | Low | Runtime assertion in `tokens.ts`; Vercel deploy smoke test checks env var presence |
| Token leaked via logging or error message | High | Low | Lint rule banning `console.log` of token-shaped values; integration test asserts no token in response |
| Concurrent token refresh race condition | Medium | Low | Idempotency guard in `ensureFreshToken`; Postgres row-level update with `WHERE expires_at < now() + interval '5 min'` |

## Related Documentation

- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- Architecture §"Data Protection," §"Integration Architecture," Appendix C: `docs/architecture/_main/04-Architecture.md`
- Business Requirements UC-17, UC-35: `docs/architecture/_main/03-Business-Requirements.md`
- ADR-009 (approval gate, referenced by downstream waves): `docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md`
