---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "7"
feature: "8.1"
wave: "8.1.1"
agents: []
tags: [coriven, stripe, billing, subscription, tiers, webhooks, mealprepforge]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md"
---

# Wave 8.1.1: Stripe Billing and Tiers

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.1.1 |
| Feature | 7.1 — Stripe Billing and Tiers |
| Epic | 7 — Productization |
| Status | Planning |
| Scope | Add `subscription_tier` to `profiles`; wire Stripe Checkout (monthly and annual) and a verified webhook that idempotently updates the tier; expose billing self-management in Settings. |
| Wave Goal | A Coriven user can subscribe to Core ($12/mo) or Pro ($22/mo) through Stripe Checkout, and the `profiles.subscription_tier` column reflects the live subscription state within seconds of a Stripe lifecycle event. |

**Wave Philosophy:** Scope-based — this wave closes when the billing data path is complete and independently verifiable (a Stripe test-mode subscription activates and gates tools), not on a schedule.

## Wave Goals

1. `profiles.subscription_tier` (free/core/pro) exists, is RLS-isolated, and is the single source of truth for tier state as required by Vision §16.3 monetization tiers.
2. Stripe Checkout sessions for Core and Pro (monthly and annual = 2 months free) create real subscriptions via MealPrepForge LLC's existing account; all product/price IDs are read exclusively from env vars — no hardcoded strings.
3. The Stripe webhook handler is idempotent and signature-verified; it updates `subscription_tier` on `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`; manual and automated tests confirm idempotency (double-delivery is a no-op).

## User Stories

---

### Story 7.1.1.1 — Subscription Tier Column and Billing Metadata

**As the** billing system,
**I want** `profiles` to carry a `subscription_tier` column and supporting billing metadata,
**So that** every tier check, tool enforcement, and Stripe reconciliation has a single source of truth with no cross-table joins in the hot path.

**Reference:** Business Requirements Feature 9, UC-14; Vision §16.3; ADR-011.

**Priority:** Critical
**Estimated hours:** 6

**Acceptance Criteria:**
- `profiles.subscription_tier` exists as a Postgres enum (`free | core | pro`) with a default of `free`.
- `profiles.stripe_customer_id` (nullable text) and `profiles.trial_ends_at` (nullable timestamptz) are present.
- RLS on `profiles` permits a user to SELECT their own row and prevents them from writing `subscription_tier` directly (only the service role or the webhook handler updates it).
- The migration applies cleanly against the existing schema.
- TypeScript types are regenerated and reflect the new columns.

---

#### Task 7.1.1.1.1 — Migration: Add Billing Columns to Profiles

| Field | Value |
|---|---|
| Parent Story | 7.1.1.1 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | None — profiles table exists |
| Deliverables | `supabase/migrations/<timestamp>_add_billing_columns_to_profiles.sql`; regenerated `apps/web/src/types/supabase.ts` |

**Acceptance Criteria:**
- Migration is idempotent (uses `IF NOT EXISTS` and `DO $$ BEGIN ... END $$` guards).
- `subscription_tier` defaults to `'free'`; existing rows are backfilled to `'free'` without error.
- An RLS policy prevents the authenticated user role from setting `subscription_tier` via the anon/user client; only service role may write it.
- `npx supabase db push` completes without error in a fresh local Supabase instance.

---

#### Task 7.1.1.1.2 — TypeScript Tier Guard Utility

| Field | Value |
|---|---|
| Parent Story | 7.1.1.1 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Task 7.1.1.1.1 |
| Deliverables | `apps/web/src/lib/billing/tiers.ts` — exported `getTierForUser(userId)`, `isCoreOrAbove(tier)`, `isProOrAbove(tier)`, `TIER_LIMITS` constant object |

**Acceptance Criteria:**
- `TIER_LIMITS` encodes entity cap (Free 10, Core/Pro unlimited), reminder daily cap (Free 1, Core 3, Pro unlimited), and memory window hours (Free 24, Core 168, Pro 720) — all sourced from a single constant, never duplicated.
- `getTierForUser` fetches via the server Supabase client (auth-server variant) and returns the enum value.
- Unit tests cover each helper for all three tiers.

---

### Story 7.1.1.2 — Stripe Checkout Session

**As a** free user who has reached the entity cap,
**I want** to click an upgrade CTA and be taken to Stripe Checkout,
**So that** I can subscribe to Core or Pro without leaving my browser and without giving Coriven my card details.

**Reference:** Business Requirements Feature 9, UC-14; Vision §16.3–16.4; PCI scope: Stripe handles all card data.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- A `POST /api/billing/checkout` API route accepts `{ plan: 'core' | 'pro', interval: 'month' | 'year' }` and returns a Stripe Checkout session URL.
- Price IDs are read exclusively from `STRIPE_PRICE_CORE_MONTHLY`, `STRIPE_PRICE_CORE_ANNUAL`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL` env vars; no price ID appears in code.
- The session uses `mode: 'subscription'`, sets `customer_email` from `profiles.email`, and attaches `metadata.user_id` so the webhook can match the Supabase user.
- A `stripe_customer_id` that already exists on the profile is reused (no duplicate Stripe customers on re-subscribe).
- Unauthenticated requests return 401; invalid `plan`/`interval` return 400 with a clear message.
- Annual plans reflect 2 months free (Stripe coupon or discounted price configured in the MealPrepForge Stripe account).

---

#### Task 7.1.1.2.1 — Stripe SDK Setup and Environment Validation

| Field | Value |
|---|---|
| Parent Story | 7.1.1.2 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | None |
| Deliverables | `apps/web/src/lib/billing/stripe.ts` (singleton Stripe client); `.env.example` updated with all `STRIPE_*` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` vars |

**Acceptance Criteria:**
- Stripe client is instantiated once with `STRIPE_SECRET_KEY` from env; throws a clear startup error if the key is missing.
- `.env.example` documents every required Stripe env var with placeholder values and comments.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are never accessed in any file importable by the browser bundle (server-only guard).
- Security: no Stripe secret leaks via `NEXT_PUBLIC_` prefix.

---

#### Task 7.1.1.2.2 — Checkout Session Route

| Field | Value |
|---|---|
| Parent Story | 7.1.1.2 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.1.1.2.1, Task 7.1.1.1.1 |
| Deliverables | `apps/web/src/app/api/billing/checkout/route.ts`; unit/integration tests |

**Acceptance Criteria:**
- Route fetches the authenticated user, looks up or creates a Stripe customer, persists `stripe_customer_id` to `profiles` (service role), and creates a Checkout session.
- `success_url` and `cancel_url` point to the appropriate app pages.
- Integration test (with Stripe test-mode keys) verifies the session is created and the response URL is present.
- Error paths (Stripe API down, missing price ID env var) return 500 with a structured error body and are logged server-side.

---

### Story 7.1.1.3 — Stripe Webhook: Idempotent Tier Update

**As the** billing system,
**I want** Stripe lifecycle events to update `profiles.subscription_tier` reliably and exactly once,
**So that** a user's access tier is accurate even if the same event is delivered twice.

**Reference:** Business Requirements Feature 9, UC-14; Architecture §Integration — Stripe (idempotent webhook).

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- `POST /api/billing/webhook` validates the Stripe signature using `STRIPE_WEBHOOK_SECRET` before any processing; invalid signatures return 400.
- Handles `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (and `invoice.payment_failed`) — maps Stripe price IDs to the correct `subscription_tier` enum value.
- On `deleted` or `payment_failed`, tier is set to `'free'`.
- The handler is idempotent: delivering the same event twice produces the same final state and does not error.
- `stripe_customer_id` on `profiles` is set if not already present (reconcile path).
- All updates use the service-role Supabase client.
- Logs structured events for monitoring; never logs raw card data.

---

#### Task 7.1.1.3.1 — Webhook Route with Signature Verification

| Field | Value |
|---|---|
| Parent Story | 7.1.1.3 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.1.1.2.1, Task 7.1.1.1.1 |
| Deliverables | `apps/web/src/app/api/billing/webhook/route.ts`; `apps/web/src/lib/billing/webhook-handler.ts` |

**Acceptance Criteria:**
- Route reads the raw body as a buffer (Next.js 15 `bodyParser: false` equivalent) before signature verification.
- `stripe.webhooks.constructEvent` is called; any verification failure throws and returns 400.
- `webhook-handler.ts` maps event type → tier update function; each handler is a pure function testable without an HTTP layer.
- Unit tests cover: valid event → correct tier; duplicate event → idempotent; invalid signature → rejected; unknown event type → no-op (200 returned to Stripe).

---

#### Task 7.1.1.3.2 — Billing Self-Management UI (Settings Page)

| Field | Value |
|---|---|
| Parent Story | 7.1.1.3 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.1.1.2.2, Task 7.1.1.3.1 |
| Deliverables | `apps/web/src/app/settings/subscription/page.tsx`; Stripe Customer Portal redirect route at `POST /api/billing/portal` |

**Acceptance Criteria:**
- Settings > Subscription page shows the current tier name, renewal date (from Stripe), and a "Manage Billing" button.
- "Manage Billing" opens the Stripe Customer Portal (self-hosted via the portal route) where the user can change plan, update payment, or cancel.
- Free users see a "Upgrade" CTA linking to the pricing page.
- The page is server-rendered with the current tier from `profiles`; no client-side fetch for the tier itself.
- WCAG AA: all interactive elements are keyboard-reachable with visible focus; text contrasts meet AA minimums.

---

### Story 7.1.1.4 — Lifetime Deal ($199) Checkout Flow

**As a** beta user who wants permanent access,
**I want** to purchase the $199 lifetime deal through Stripe Checkout,
**So that** I never pay a recurring subscription and my tier is set to `pro` permanently.

**Reference:** Vision §Go-to-Market — Lifetime deal, first 200 signups.

**Priority:** High
**Estimated hours:** 6

**Acceptance Criteria:**
- A separate Stripe one-time payment product (price ID via `STRIPE_PRICE_LIFETIME` env var) is supported in the Checkout route when `interval: 'lifetime'` is passed.
- On `checkout.session.completed` for a one-time payment, the webhook sets `subscription_tier` to `'pro'` and writes `trial_ends_at = null` (permanent).
- The pricing page displays the lifetime option with a "first 200" scarcity note (the count is a static config value, not a live query — correctness is owner's responsibility at launch).
- Unit test confirms the webhook maps a one-time payment completion to `'pro'` tier.

---

#### Task 7.1.1.4.1 — Lifetime Payment Webhook Path

| Field | Value |
|---|---|
| Parent Story | 7.1.1.4 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.1.1.3.1 |
| Deliverables | Extended `webhook-handler.ts` with `checkout.session.completed` for payment mode; unit tests |

**Acceptance Criteria:**
- `checkout.session.completed` with `mode: 'payment'` sets tier to `'pro'` via service role.
- Subscription-mode completion is handled separately (covered by Task 7.1.1.3.1) — no cross-contamination.
- Idempotency: re-delivery of the same session ID is a no-op.

---

## Task Dependencies

```
Task 7.1.1.1.1 (migration)
  └── Task 7.1.1.1.2 (tier utility)
       └── Task 7.1.1.2.2 (checkout route)  ← also depends on 7.1.1.2.1
            └── Task 7.1.1.3.1 (webhook route)
                 └── Task 7.1.1.3.2 (billing settings UI)
                 └── Task 7.1.1.4.1 (lifetime payment webhook)

Task 7.1.1.2.1 (Stripe SDK setup) — no dependencies; can start immediately in parallel with 7.1.1.1.1
```

**Critical path:** migration → tier utility → Stripe SDK → checkout route → webhook route → settings UI.
**Parallelizable:** 7.1.1.1.1 and 7.1.1.2.1 can begin simultaneously.

## Definition of Done

- `profiles.subscription_tier` column exists; migration applies cleanly; TypeScript types regenerated.
- Stripe Checkout creates a real test-mode subscription for Core and Pro (monthly and annual); price IDs are 100% env-var-driven with no hardcoded strings.
- Webhook signature verification blocks unsigned requests; verified events update `subscription_tier` correctly for create/update/delete lifecycle events.
- Duplicate event delivery (idempotency) is confirmed by a unit test — same event twice, same final state, no error.
- Lifetime payment path sets tier to `pro` permanently.
- Settings > Subscription page renders current tier and provides a working Stripe Customer Portal link.
- All Stripe secret keys confirmed server-only; `.env.example` updated.
- Unit and integration test suite passes in CI.

## Infrastructure Specifications

### Database

- **Migration name:** `<timestamp>_add_billing_columns_to_profiles`
- **Columns added to `profiles`:**
  - `subscription_tier subscription_tier_enum NOT NULL DEFAULT 'free'` (new Postgres enum: `free`, `core`, `pro`)
  - `stripe_customer_id text` (nullable)
  - `trial_ends_at timestamptz` (nullable)
- **RLS:** Existing user SELECT/UPDATE policies on `profiles` remain; a separate service-role-only policy for `subscription_tier` writes is added (or a Postgres check constraint ensures the anon role cannot write that column directly).
- **Index:** `CREATE INDEX ON profiles (stripe_customer_id)` for webhook customer lookup.

### API

#### `POST /api/billing/checkout`
- **Auth:** Supabase session cookie required (401 if absent).
- **Request body:** `{ plan: 'core' | 'pro' | 'lifetime', interval: 'month' | 'year' | 'lifetime' }`
- **Response:** `{ url: string }` (Stripe Checkout URL) or structured error.
- **Validation:** `plan` and `interval` combination must be valid; price ID env var must be present (startup check).
- **Error codes:** 400 (invalid body), 401 (unauthenticated), 500 (Stripe API error).

#### `POST /api/billing/webhook`
- **Auth:** Stripe webhook signature header (`stripe-signature`); no Supabase session.
- **Request:** raw body (must not be parsed by Next.js before signature check).
- **Events handled:** `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `checkout.session.completed`.
- **Response:** 200 on success or known no-op; 400 on bad signature; 500 on handler error.
- **Idempotency:** handler checks current tier before writing; no-op if the update would set the same value.

#### `POST /api/billing/portal`
- **Auth:** Supabase session cookie required.
- **Response:** `{ url: string }` (Stripe Customer Portal URL).
- **Validation:** User must have a `stripe_customer_id`; 400 if not.

### UI

- **Settings > Subscription page (`/settings/subscription`):**
  - Server component reads `profiles.subscription_tier` and `trial_ends_at`.
  - Displays tier badge (Free / Core / Pro), next renewal date, "Manage Billing" → portal, "Upgrade" → `/pricing`.
  - Props: none (data fetched server-side via auth-server Supabase client).
  - Accessibility: tier badge uses `role="status"`; buttons have visible focus ring; color is not the only tier indicator.

### Testing

- **Unit tests:** `webhook-handler.ts` — all event types, idempotency, invalid signature, lifetime payment.
- **Unit tests:** tier utility helpers — all three tiers, boundary conditions.
- **Integration tests:** Checkout route with Stripe test-mode keys (Stripe SDK mock or test-mode API).
- **Integration tests:** Webhook route — valid payload with correct test secret, invalid signature path.
- **E2E (Playwright, optional at this wave):** Checkout flow in Stripe test mode through the UI.
- **Coverage target:** >80% branch coverage on billing lib files.

### Deployment

- **New env vars (must be added to Vercel project before deploy):**
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_PRICE_CORE_MONTHLY`
  - `STRIPE_PRICE_CORE_ANNUAL`
  - `STRIPE_PRICE_PRO_MONTHLY`
  - `STRIPE_PRICE_PRO_ANNUAL`
  - `STRIPE_PRICE_LIFETIME`
- **Stripe webhook endpoint:** register `<NEXT_PUBLIC_APP_URL>/api/billing/webhook` in the MealPrepForge Stripe dashboard; copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
- **Stripe product configuration:** Core and Pro products/prices created in the MealPrepForge Stripe account (second product line); annual prices reflect 2-month discount.

### Monitoring

- Log every webhook event received (event ID, type, user_id resolved) — structured, no card data.
- Alert on webhook handler errors (5xx response rate to Stripe > 0).
- Track `subscription_tier` distribution in `profiles` as a periodic query for conversion reporting.
- Stripe Dashboard provides subscription event history as the primary billing audit trail.

## Handoff Requirements

- Stripe MealPrepForge account access and the ability to create products/prices and register a webhook endpoint.
- All `STRIPE_*` env vars populated in `.env.local` for local dev and in the Vercel project for production.
- Local Supabase instance running (`npx supabase start`) for migration verification.
- The Stripe CLI (`stripe listen --forward-to localhost:3000/api/billing/webhook`) for local webhook testing.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Stripe account not yet configured for Coriven as a second product line | High — blocks checkout | Medium | Owner action: create products/prices in Stripe dashboard before Task 7.1.1.2.2 |
| Missouri DBA registration not yet active | Medium — blocks public-facing payments | Low | Payments work in test mode; register DBA before live launch |
| Stripe webhook delivery reliability in production | Medium | Low | Idempotent handler; Stripe auto-retries on non-2xx; reconcile on profile read |
| Price tiers unvalidated (beta users may not pay $12/$22) | Medium — business risk | Medium | Launch as hypothesis (ADR-011); instrument conversion; revisit with beta data |
| Next.js body parsing interfering with webhook signature verification | Medium | Medium | Use `request.arrayBuffer()` or equivalent raw-body approach before constructEvent |

## Related Documentation

- Product Vision: `docs/architecture/_main/01-Product-Vision.md` §Go-to-Market, §Pricing Strategy
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` Feature 9, UC-14
- Architecture: `docs/architecture/_main/04-Architecture.md` §Integration Architecture (Stripe), Appendix C
- ADR-011: `docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md`
- Epic 8: `docs/implementation/_main/epic-7-productization.md`
