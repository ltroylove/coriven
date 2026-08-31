---
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.1"
wave: "5.1.1"
agents: []
tags: [coriven, nango, oauth, integrations, database, rls, infrastructure]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 5.1.1: Nango Infrastructure & Integrations Schema

## Wave Overview
- **Wave ID:** Wave-5.1.1
- **Feature:** Feature 5.1 - Nango Integration & Provider Connect UI
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Self-hosted Nango instance running and configured for Gmail, Outlook, and Google Calendar; `integrations` table (connection IDs only — no raw tokens) with RLS; server-side token wrapper that all subsequent Epic 5 features use to obtain provider tokens; environment wiring in Vercel.
- **Wave Goal:** Establish Nango as Coriven's single OAuth authority — infrastructure, database schema, and the one sanctioned server-side path to a provider token — so the connect/disconnect UI (Wave 5.1.2) and every later Epic 5 feature build on a stable token layer.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A self-hosted Nango instance is deployed, reachable from the Coriven server environment, and configured with provider integrations for Gmail, Outlook, and Google Calendar at minimum OAuth scopes (ADR-013).
2. The `integrations` table is live in Supabase storing only opaque Nango connection identifiers per user/provider — no raw access or refresh tokens, no encryption key, with RLS isolating every row to its owner.
3. A single server-side wrapper is the only way Coriven code obtains a provider token; it resolves a user + provider to a fresh token via Nango and surfaces clear errors when a connection is missing or revoked.
4. All required secrets and environment variables are wired in Vercel and documented in the env template, with nothing sensitive committed to the repo.

## User Stories

### User Story 1: Nango instance as OAuth authority

**As the** owner/operator
**I want** a self-hosted Nango instance deployed and configured for Gmail, Outlook, and Google Calendar
**So that** all provider OAuth flows, token storage, and token refresh are handled by a dedicated multi-tenant authority instead of custom code in Coriven

**Acceptance Criteria:**
- [ ] The Nango instance is deployed on managed container hosting and reachable over HTTPS from the Coriven server environment.
- [ ] Provider integrations exist in Nango for Gmail, Outlook (Microsoft Graph), and Google Calendar, each requesting only the minimum scopes defined in ADR-013.
- [ ] A test OAuth connection can be completed end-to-end against at least one provider using a development account.
- [ ] Nango admin access is secured; no Nango credentials or secrets appear anywhere in the repository.

**Priority:** High

---

### User Story 2: Integrations recorded without raw tokens

**As a** Coriven user
**I want** my provider connections recorded as opaque connection references only
**So that** no raw OAuth token ever sits in Coriven's database and there is no encryption key whose compromise exposes my accounts

**Acceptance Criteria:**
- [ ] A user's connection is stored as a row containing the provider, an opaque Nango connection identifier, the granted scopes, and connection timestamps — nothing else credential-like.
- [ ] A user can have at most one connection per provider; attempting to record a duplicate is rejected at the database level.
- [ ] No column for raw or encrypted tokens exists, and no data-encryption key is required anywhere in the schema or environment.
- [ ] One user's integration rows are invisible to any other authenticated user.
- [ ] Deleting a user cascades to their integration rows.

**Priority:** High

---

### User Story 3: One sanctioned path to a provider token

**As a** developer building later Epic 5 features
**I want** a single server-side wrapper that resolves a user and provider to a fresh access token
**So that** email polling, calendar sync, and approved-action execution all share one audited, refresh-safe token path

**Acceptance Criteria:**
- [ ] Given a user who has connected a provider, the wrapper returns a valid, fresh access token for that provider; token refresh is handled transparently by Nango.
- [ ] Given a user who has not connected the provider (or whose connection was revoked), the wrapper returns a distinct, well-typed error rather than throwing opaquely.
- [ ] The wrapper is usable only server-side; no token or Nango secret is ever exposed to client code.
- [ ] The wrapper resolves the correct connection for the requesting user only — cross-user token retrieval is impossible by construction.

**Priority:** High

---

### User Story 4: Deployable environment configuration

**As the** owner/operator
**I want** all Nango-related configuration wired into the deployed environments
**So that** the same code runs locally and on Vercel without secrets in the repo

**Acceptance Criteria:**
- [ ] All required Nango environment variables are set in Vercel for the production environment and documented (names only) in the env template.
- [ ] Local development works against the same variable names via the local env file.
- [ ] A missing or malformed required variable produces a clear startup/runtime error rather than silent failure.

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: Record a connection
- **Endpoint:** Internal — `integrations` table insert (service context)
- **Method:** INSERT
- **Test Data:** Valid user ID, provider `gmail`, opaque connection ID, scopes array
- **Expected Result:** Row created with `connected_at` populated
- **Verification:** Row readable by owning user; unique constraint prevents a second `gmail` row for the same user

### Test Case 2: RLS isolation
- **Endpoint:** Internal — `integrations` table select (user context)
- **Method:** SELECT
- **Test Data:** Rows for user A; query executed as user B
- **Expected Result:** Zero rows returned for user B
- **Verification:** User-role client (not service role) used for the isolation assertion

### Test Case 3: Token retrieval for connected provider
- **Endpoint:** Internal — server-side token wrapper
- **Method:** Function call
- **Test Data:** User with an active test connection, provider `gmail`
- **Expected Result:** Non-empty access token returned
- **Verification:** Token accepted by a lightweight provider API call (e.g., profile fetch) on a dev account

### Test Case 4: Token retrieval for missing connection
- **Endpoint:** Internal — server-side token wrapper
- **Method:** Function call
- **Test Data:** User with no connection for provider `outlook`
- **Expected Result:** Typed "not connected" error, no exception leak
- **Verification:** Error is distinguishable from transient Nango/network errors

## Technical Tasks

### Task 1: Deploy self-hosted Nango and configure providers
- **Agent:** devops-specialist
- **Estimation:** 6-8 hours (uncertainty: first-time Nango self-host; Google/Microsoft OAuth app setup may add external wait time)
- **Dependencies:** None
- **Priority:** High

**Deliverables:**
- Running Nango instance on managed container hosting (Railway or equivalent), HTTPS-reachable
- Google OAuth app and Microsoft Entra app registrations with minimum scopes; both registered as provider configs in Nango
- Deployment notes (host, provider config keys, callback URLs) captured in the repo docs — no secrets

**Acceptance Criteria:**
- [ ] A manual end-to-end OAuth connect succeeds against at least one provider from the Nango-hosted flow
- [ ] Provider configs request only the ADR-013 minimum scopes
- [ ] Nango instance uses **external Postgres + Redis** (bundled containers use transient storage and are not production-safe); these must be separate services, not co-mingled with Coriven's Supabase instance (ADR-013 §Nango deployment)
- [ ] **Nango encryption key vaulted before first deploy** — it cannot be rotated after setup; the compromise runbook (bulk revoke via provider APIs + re-auth all users) is documented in the repo before the instance goes live (ADR-013 §Nango deployment)
- [ ] **Written confirmation obtained from Nango** that Auth-only self-hosted commercial production use is permitted under Elastic License 2.0; the answer is recorded in ADR-013 (ADR-013 §Nango deployment)
- [ ] Nango instance is **network-isolated** — only Coriven's server-side code can reach it; no public admin surface is unauthenticated (ADR-013 §Nango deployment)

---

### Task 2: `integrations` table migration with RLS
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (parallel with Task 1)
- **Priority:** High

**Deliverables:**
- SQL migration creating the `integrations` table per the Infrastructure Specifications below
- Regenerated Supabase TypeScript types

**Acceptance Criteria:**
- [ ] Migration applies cleanly to a local Supabase instance
- [ ] Uniqueness per user/provider and RLS isolation verified as in Test Cases 1-2
- [ ] No token columns and no encryption-key dependency anywhere in the migration

---

### Task 3: Shared integration types
- **Agent:** backend-specialist
- **Estimation:** 2-3 hours
- **Dependencies:** None (parallel)
- **Priority:** Medium

**Deliverables:**
- `Integration` type and provider enum/union exported from the shared types package

**Acceptance Criteria:**
- [ ] Provider union covers gmail, outlook, google_calendar, outlook_calendar
- [ ] Monorepo typecheck passes; no type duplication in the web app

---

### Task 4: Server-side Nango token wrapper
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours
- **Dependencies:** Task 1 (live Nango to test against), Task 2 (connection lookup), Task 3 (types)
- **Priority:** High

**Deliverables:**
- Server-only module exposing a `getToken(userId, provider)` capability backed by the Nango Node SDK
- Typed error model distinguishing "not connected" from transient failures
- Unit tests for connected, not-connected, and Nango-error paths

**Acceptance Criteria:**
- [ ] Behaves per User Story 3 acceptance criteria
- [ ] Structured logging on failures with no token values in logs

---

### Task 5: Environment wiring (Vercel + env template)
- **Agent:** devops-specialist
- **Estimation:** 2 hours
- **Dependencies:** Task 1 (values exist)
- **Priority:** Medium

**Deliverables:**
- `NANGO_SECRET_KEY` and `NANGO_HOST` set in Vercel; names documented in the env template
- Confirmation that no `DATA_ENCRYPTION_KEY` remains referenced anywhere

**Acceptance Criteria:**
- [ ] Deployed environment can reach Nango using only configured variables
- [ ] Env template lists all new variables with placeholder values only

## Task Dependencies

```
Task 1 (Nango deploy + providers)     Task 2 (migration)     Task 3 (shared types)
        │                                  │                       │
        ├──────────────┬───────────────────┴───────────────────────┘
        │              ▼
        │        Task 4 (token wrapper)
        ▼
  Task 5 (env wiring)
```

**Critical path:** Task 1 → Task 4 (the wrapper cannot be verified without a live Nango instance).
**Parallel streams:** Tasks 1, 2, and 3 have no interdependencies and can proceed concurrently.
**Bottleneck:** Google/Microsoft OAuth app registration (Task 1) may involve external review wait time — start it first.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| devops-specialist | Task 1, Task 5 | 8-10 |
| backend-specialist | Task 2, Task 3, Task 4 | 10-13 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (RLS isolation, end-to-end token retrieval on a dev account)
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security check: no raw tokens in DB, no secrets in repo, no encryption-key references remaining
- [ ] Documentation updated (env template, deployment notes)
- [ ] Deployed: Nango live, migration applied, env vars set in Vercel

## Infrastructure Specifications

### Nango Deployment

- **Hosting:** Self-hosted via Docker on managed container hosting (Railway preferred; Render acceptable). Nango Cloud explicitly out of scope for validation (Epic 5 scope).
- **External Postgres + Redis required:** bundled containers use transient storage and are not production-safe. Use separate managed services; do not co-mingle with Coriven's Supabase.
- **Encryption key:** the Nango encryption key must be vaulted (e.g. in a secrets manager) **before** first deploy — it cannot be rotated after setup. Document the compromise runbook (bulk revoke via provider APIs + re-auth all users) in the repo before the instance goes live.
- **ELv2 confirmation:** obtain written confirmation from Nango that Auth-only self-hosted commercial production use is permitted under Elastic License 2.0 before the instance processes real user connections. Record the answer in ADR-013.
- **Exposure:** HTTPS only. The Nango dashboard/admin surface must not be publicly unauthenticated. **Network-isolate the instance** — only Coriven's server-side code should be able to reach it.
- **Provider configs (in Nango):**
  - Gmail — scopes: `gmail.readonly`, `gmail.send`
  - Microsoft Graph (Outlook mail) — scopes: `Mail.Read`, `Mail.Send`
  - Google Calendar — scopes: `calendar.readonly`, `calendar.events`
  - (Outlook Calendar provider config may be added when Feature 5.4 needs it; the DB enum includes it now to avoid a later migration.)
- **Multi-tenancy:** One Nango instance for all Coriven users; per-user isolation via one Nango connection per user/provider. Coriven's user ID (or a derivative) is the connection's identifying key on the Nango side.
- **SDK:** `@nangohq/node`, server-side only.

### Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `NANGO_SECRET_KEY` | Vercel + local env | Authenticates server-side SDK calls to Nango |
| `NANGO_HOST` | Vercel + local env | Base URL of the self-hosted Nango instance |

Explicitly removed/forbidden: `DATA_ENCRYPTION_KEY` and any `access_token_encrypted` / `refresh_token_encrypted` storage — superseded by ADR-013.

### Database

**Table:** `integrations`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id) ON DELETE CASCADE` | RLS anchor |
| `provider` | `integration_provider` enum | NOT NULL | `gmail` \| `outlook` \| `google_calendar` \| `outlook_calendar` |
| `nango_connection_id` | `text` | NOT NULL | Opaque identifier; resolves to a token only inside Nango's authenticated API — not a secret, but not user-editable |
| `scopes` | `text[]` | NOT NULL, `DEFAULT '{}'` | Scopes granted at connect time |
| `connected_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | |
| `updated_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | |

**Constraints & Indexes:**
- `UNIQUE (user_id, provider)` — one connection per provider per user
- Index on `(user_id)` for settings-page listing

**RLS:**
- `ENABLE ROW LEVEL SECURITY`
- Policy scoping SELECT/INSERT/UPDATE/DELETE to `user_id = auth.uid()`; service-role bypass consistent with existing tables


### Testing

- Unit: token wrapper (connected / not connected / Nango error), connection-row helpers.
- Integration: RLS isolation with a user-role client; end-to-end token retrieval against a dev provider account.
- No mocking of the RLS assertion — must run against a real Supabase instance.

### Monitoring

- Structured log on token retrieval failure: user, provider, error class — never token values.
- Nango instance health checked by hosting platform (restart-on-crash); an unreachable Nango must surface as a typed transient error in the wrapper, not a hang.

## Handoff Requirements

**For next wave (5.1.2):**
- Live Nango instance with Gmail, Outlook, and Google Calendar provider configs (the connect UI initiates flows against these).
- `integrations` table applied with regenerated types (the UI reads/writes connection rows via Server Actions).
- Shared provider types stable.

**For other Features/Epics:**
- Features 5.2-5.4: the token wrapper is the only sanctioned token path — its error model and signature must be stable before polling/sync work starts.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Google OAuth app verification delays | Med | Start app registration immediately; use test users during development (epic risk register) |
| Self-hosted Nango ops burden exceeds solo capacity | Med | Railway managed containers; Nango Cloud is the documented fallback (ADR-013 open question 1) |
| Nango SDK/API surface differs from assumptions | Med | Task 1 includes a manual end-to-end connect before wrapper work begins; adjust wrapper design to observed behavior |
| Provider scope naming drift (Google vs Microsoft formats) | Low | Scopes recorded verbatim from the grant; ADR-013 is the scope source of truth |

## Notes and Assumptions

- Effort figures are scope-based estimates by a solo developer; Task 1 carries the most uncertainty (first Nango self-host + external OAuth app review) and is flagged accordingly.
- Nango self-hosted (not Cloud) per Epic 5 scope; revisit at productization.
- No connect/disconnect UI in this wave — Wave 5.1.2 owns all user-facing flows. This wave verifies OAuth end-to-end via Nango's own flow with a dev account.
- The `outlook_calendar` enum value is included now purely to avoid a schema migration in Feature 5.4.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.1)
- Architecture Decision: docs/architecture/decisions/ADR-013-integration-token-authority.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§11, §17.4, §20)

## Wave Retrospective

{This section will be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
