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
epic: "7"
feature: "7.3"
wave: "7.3.1"
agents: []
tags: [coriven, conversion, upgrade-prompt, pricing-page, trial, entity-cap, paywall, ux]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
  - "docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md"
---

# Wave 7.3.1: Conversion UX — Prompts, Pricing, and Trial

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.3.1 |
| Feature | 7.3 — Conversion UX |
| Epic | 7 — Productization |
| Status | Planning |
| Scope | Contextual upgrade prompts at the entity and reminder caps; a standalone pricing page; a 7-day Core trial flow with no credit card at signup — all triggering at the value moment, not on a schedule. |
| Wave Goal | A Free user who hits the entity cap sees "Coriven can't remember anyone else" and can start a 7-day Core trial (no credit card) or subscribe directly; the experience is accessible, contextually appropriate, and drives measurable conversion. |

**Wave Philosophy:** Scope-based — this wave closes when the cap-hit prompt, pricing page, and trial flow are end-to-end functional and meet accessibility standards, regardless of schedule.

## Wave Goals

1. The entity-cap upgrade prompt fires in-chat at exactly the value moment (entity #10) and presents the 7-day no-CC trial as the primary CTA — satisfying Vision §Go-to-Market and the conversion thesis from ADR-011 that "the moment Coriven can't remember any more is when the user feels the value most."
2. The pricing page accurately represents all tiers (Free / Core $12/mo / Pro $22/mo / Lifetime $199) with annual pricing (2 months free), is accessible to unauthenticated visitors, and links to Stripe Checkout for paid plans.
3. The 7-day Core trial activates without a credit card, sets `trial_ends_at` on `profiles`, temporarily lifts the entity cap, and sends a contextual reminder as the trial nears expiration — aligning with Business Requirements UC-22 and the "trial triggers contextually at the cap" specification.

## User Stories

---

### Story 7.3.1.1 — Entity-Cap Upgrade Prompt in Chat

**As a** Free user who has just hit the 10-entity limit,
**I want** to see a clear, contextual message in the chat explaining that Coriven can't remember more people right now and offering an upgrade path,
**So that** I understand the limit in terms of value (memory) rather than a generic error, and I can act immediately.

**Reference:** Business Requirements Feature 9, UC-22; Vision §Pricing Strategy; UX §Error Handling UX (cap reached); UX Pass 5 (cap state); UX Pass 6 (tier limits must be visible when hit); ADR-011.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- When the entity-creation tool handler returns `reason: 'entity_cap'`, the chat assistant message includes language equivalent to "Coriven can't remember anyone else right now — you've reached the 10-person limit on the Free plan."
- The message includes two clear options: "Start a free 7-day trial" (primary) and "See all plans" (secondary).
- Both options are rendered as interactive elements in the chat UI (buttons or links), not as plain text.
- The prompt is contextually accurate — it fires after the blocked create, not preemptively.
- WCAG AA: the CTA buttons have sufficient contrast, visible focus, and descriptive labels (not "click here").
- Reminder-cap hit uses an analogous prompt with `reason: 'reminder_cap'` ("You've set your reminder for today — the Free plan includes 1 per day").

---

#### Task 7.3.1.1.1 — Cap-Hit Message Component

| Field | Value |
|---|---|
| Parent Story | 7.3.1.1 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Wave 7.2.1 (cap-hit tool result format established) |
| Deliverables | `apps/web/src/components/billing/CapHitPrompt.tsx`; Storybook story or equivalent visual test |

**Acceptance Criteria:**
- `CapHitPrompt` accepts `{ capType: 'entity' | 'reminder'; onStartTrial: () => void; onSeePlans: () => void }`.
- Renders the contextually accurate message for each cap type.
- "Start 7-day trial" button is visually primary; "See all plans" is secondary.
- `role="alert"` on the container so screen readers announce it immediately.
- `prefers-reduced-motion` respected for any entry animation.
- Snapshot/visual test captures the rendered output for both cap types.

---

#### Task 7.3.1.1.2 — Integrate Cap-Hit Prompt into Chat Message Rendering

| Field | Value |
|---|---|
| Parent Story | 7.3.1.1 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.3.1.1.1; existing chat message component |
| Deliverables | Updated `apps/web/src/components/chat/message.tsx`; integration test |

**Acceptance Criteria:**
- When a tool result in an assistant message carries `reason: 'entity_cap'` or `reason: 'reminder_cap'`, the chat message renders `CapHitPrompt` inline below the natural-language text.
- The existing assistant message rendering for non-cap tool results is unchanged.
- The "Start 7-day trial" button in the prompt triggers the trial flow (Task 7.3.1.3.1) without navigating away from the chat.
- The "See all plans" button navigates to `/pricing`.
- Integration test: mock a message with `reason: 'entity_cap'`; assert `CapHitPrompt` renders with correct props.

---

### Story 7.3.1.2 — Pricing Page

**As a** prospective user (authenticated or not),
**I want** to see a clear pricing page comparing Free, Core, Pro, and Lifetime tiers,
**So that** I understand the cost and feature differences before committing to a paid plan.

**Reference:** Business Requirements Feature 9; Vision §Pricing Strategy §Go-to-Market.

**Priority:** High
**Estimated hours:** 8

**Acceptance Criteria:**
- `/pricing` is accessible without authentication (no redirect to sign-in).
- Page displays four tiers: Free ($0), Core ($12/mo or $10/mo billed annually), Pro ($22/mo or ~$18.33/mo billed annually), Lifetime ($199 one-time — "first 200").
- A monthly/annual toggle switches displayed prices; annual prices reflect 2 months free.
- Each tier lists its key features (entity limit, memory window, reminder cap, device access).
- Paid tier CTAs link to `POST /api/billing/checkout` with the appropriate plan/interval.
- An authenticated user on the Free tier sees their current tier highlighted with a "Current plan" badge; paid tiers show "Upgrade."
- An authenticated user already on Core sees Core highlighted; Pro shows "Upgrade"; Free shows "Downgrade" (links to Customer Portal).
- Page is fully keyboard-navigable; monthly/annual toggle is a `<fieldset>` with radio buttons, not a div click; all feature list items are in `<ul>/<li>` with meaningful labels.

---

#### Task 7.3.1.2.1 — Pricing Page Layout and Tier Cards

| Field | Value |
|---|---|
| Parent Story | 7.3.1.2 |
| Agent | frontend-specialist |
| Estimation | 8h |
| Dependencies | Wave 7.1.1 (Checkout route); Wave 7.2.1 (tier from middleware header or server component fetch) |
| Deliverables | `apps/web/src/app/pricing/page.tsx`; `apps/web/src/components/billing/PricingCard.tsx`; `apps/web/src/components/billing/PricingToggle.tsx` |

**Acceptance Criteria:**
- `PricingCard` accepts `{ tierName, price, interval, features: string[], isCurrent: boolean, ctaLabel: string, onCTA: () => void }`.
- `PricingToggle` uses `<input type="radio">` elements within a `<fieldset>` for the monthly/annual switch.
- Tier prices and features are defined in a single `PRICING_CONFIG` constant (no duplication across components).
- Annual pricing calculation: `monthlyPrice * 10 / 12` displayed as "billed annually" — formula is in one place.
- Accessible: keyboard focus moves logically through toggle → cards → CTAs; each CTA button describes the action ("Upgrade to Core — $12/month").
- Responsive: on mobile (<768px), cards stack vertically; on desktop, horizontal card row.

---

### Story 7.3.1.3 — 7-Day Core Trial (No Credit Card)

**As a** Free user who clicked "Start 7-day trial" at the entity cap,
**I want** to activate a trial of Core features immediately without entering a credit card,
**So that** I can experience the unlimited-entity and extended-memory benefits before deciding to subscribe.

**Reference:** Business Requirements Feature 9, UC-22; Vision §Go-to-Market (trial triggers contextually at the cap; no CC at signup).

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- `POST /api/billing/trial/start` activates the trial: sets `subscription_tier = 'core'` and `trial_ends_at = now() + 7 days` on `profiles` via the service-role client, without any Stripe interaction.
- A user can only start a trial once (if `trial_ends_at` is already set or they have ever had a paid tier, the endpoint returns 409 with a clear message).
- During the trial, all Core tier entitlements apply (unlimited entities, 7-day memory window, 3 reminders/day) — the enforcement middleware reads `subscription_tier = 'core'` and behaves accordingly.
- At `trial_ends_at`, a Vercel Cron job (nightly) downgrades any expired trial users back to `'free'` and reapplies Free caps.
- A "Trial ends in X days" banner displays in the app header for trial users.
- 2 days before trial expiry, the trial expiry notification fires (in-app banner upgrades to prominent; ideally also a Web Push notification if the user has granted permission — covered by Wave 7.5.1 if not yet available).
- Subscribing during the trial moves the user to a full Stripe subscription; the webhook sets the tier and clears `trial_ends_at`.

---

#### Task 7.3.1.3.1 — Trial Start Endpoint

| Field | Value |
|---|---|
| Parent Story | 7.3.1.3 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Wave 7.1.1 Task 7.1.1.1.1 (trial_ends_at column) |
| Deliverables | `apps/web/src/app/api/billing/trial/start/route.ts`; unit/integration tests |

**Acceptance Criteria:**
- `POST /api/billing/trial/start` requires authentication (401 if absent).
- Idempotency: if trial already active or the user has had a paid tier, return 409 with body `{ error: 'trial_not_eligible', reason: '...' }`.
- Sets `subscription_tier = 'core'` and `trial_ends_at = now() + interval '7 days'` atomically (single UPDATE).
- Uses service-role client; no client-side token is returned.
- Unit test: eligible user → 200, correct column values; ineligible (already trialed) → 409; unauthenticated → 401.

---

#### Task 7.3.1.3.2 — Trial Expiry Cron Job

| Field | Value |
|---|---|
| Parent Story | 7.3.1.3 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.3.1.3.1; Wave 7.1.1 (subscription_tier) |
| Deliverables | `apps/web/src/app/api/cron/expire-trials/route.ts`; Vercel cron config; unit/integration tests |

**Acceptance Criteria:**
- `GET /api/cron/expire-trials` is protected by `CRON_SECRET` header (401 if missing or wrong).
- Queries profiles where `subscription_tier = 'core'` AND `trial_ends_at < now()` AND `stripe_customer_id IS NULL` (genuine trial users, not paid subscribers).
- Bulk-updates matching rows: `subscription_tier = 'free'`, `trial_ends_at = NULL`.
- Logs count of expired trials as a structured log entry.
- Configured in `vercel.json` to run nightly (e.g., `0 6 * * *` UTC).
- Idempotent: running twice for the same expired trial produces the same final state.
- Integration test: insert a profile with `trial_ends_at` in the past; run the cron; assert `subscription_tier` is `'free'`.

---

#### Task 7.3.1.3.3 — Trial Banner and Expiry Notification in the App Header

| Field | Value |
|---|---|
| Parent Story | 7.3.1.3 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.3.1.3.1; app header/shell component |
| Deliverables | `apps/web/src/components/billing/TrialBanner.tsx`; updated app layout |

**Acceptance Criteria:**
- `TrialBanner` is rendered in the app shell when `subscription_tier = 'core'` AND `trial_ends_at` is set.
- Displays "Trial: X days remaining — Subscribe to keep access" with a "Subscribe" CTA linking to `/pricing`.
- When `trial_ends_at - now() <= 2 days`, the banner uses a visually distinct warning style (not just blue → orange counts as a functional change, not a mere color change; use an `aria-live="polite"` region and an icon with a text label, not color alone).
- When the trial is expired and tier reverts to `'free'`, the banner changes to "Your trial has ended — See plans" for one session (dismissed by closing; state in `sessionStorage`).
- WCAG AA: banner has sufficient contrast in both normal and warning states; "Subscribe" link is keyboard-focusable.

---

### Story 7.3.1.4 — Contextual Redirect from Gated Page

**As a** Free user who navigates to a page requiring a higher tier,
**I want** to see a clear explanation of why I was redirected and a direct path to upgrade,
**So that** I never land on a blank or unexplained page.

**Reference:** Business Requirements Feature 9; Architecture §Authentication and Authorization; UX Pass 6 (tier limits must be visible when hit).

**Priority:** High
**Estimated hours:** 4

**Acceptance Criteria:**
- `/pricing` accepts a `?reason=tier` query param; when present, an informational banner explains "This feature requires Core or higher" at the top of the pricing cards.
- The banner is dismissible and does not persist after the user navigates away.
- Keyboard focus is moved to the banner on page load when `?reason=tier` is present.
- WCAG AA: banner has an appropriate ARIA role (`role="alert"` or `role="status"`) and is announced to screen readers.

---

#### Task 7.3.1.4.1 — Pricing Page Contextual Redirect Banner

| Field | Value |
|---|---|
| Parent Story | 7.3.1.4 |
| Agent | frontend-specialist |
| Estimation | 4h |
| Dependencies | Task 7.3.1.2.1 (pricing page exists) |
| Deliverables | Updated `apps/web/src/app/pricing/page.tsx` to handle `?reason=tier`; `ContextualUpgradeBanner` component |

**Acceptance Criteria:**
- `?reason=tier` query param is read server-side from `searchParams`; no client-side URL parsing.
- Banner renders above the pricing cards with the message "You need Core or Pro to access that feature — choose a plan below."
- On page load with the param, `autoFocus` is set on the banner container (or focus is moved programmatically after mount).
- Without `?reason=tier`, the banner is not rendered (no empty space or hidden element).

---

## Task Dependencies

```
Wave 7.1.1 (billing columns, Checkout route) — prerequisite
Wave 7.2.1 (cap-hit tool result format) — prerequisite for 7.3.1.1.x

Task 7.3.1.1.1 (CapHitPrompt component)
  └── Task 7.3.1.1.2 (integrate into chat)

Task 7.3.1.2.1 (pricing page) — can start after Wave 7.1.1, in parallel with 7.3.1.1.x

Task 7.3.1.3.1 (trial start endpoint)
  └── Task 7.3.1.3.2 (trial expiry cron)
  └── Task 7.3.1.3.3 (trial banner)

Task 7.3.1.4.1 (contextual redirect banner) — depends on Task 7.3.1.2.1
```

**Critical path:** Wave 7.1.1 → Wave 7.2.1 → cap-hit prompt → trial endpoint → trial banner.
**Parallelizable:** pricing page (7.3.1.2.1) and cap-hit prompt tasks (7.3.1.1.x) can start simultaneously after Wave 7.2.1.

## Definition of Done

- Entity-cap prompt fires in chat at entity #10; reminder-cap prompt fires at daily limit; both prompts render interactive "Start trial" and "See plans" CTAs — confirmed by integration test and manual review.
- Pricing page renders all four tiers with correct prices and features; monthly/annual toggle works; appropriate CTA state for authenticated user's current tier — confirmed by review.
- Trial start endpoint activates Core tier without a credit card; only eligible (never-trialed) users can start; confirmed by unit test.
- Trial expiry cron downgrades expired trials to Free nightly; idempotent; confirmed by integration test.
- Trial banner appears for active trial users; warning style at ≤2 days; subscribe CTA links to pricing.
- Gated-page redirect includes contextual banner on `/pricing?reason=tier`.
- All WCAG AA criteria met: keyboard nav, contrast, ARIA roles, `prefers-reduced-motion`.
- CI test suite passes.

## Infrastructure Specifications

### Database

- No new migrations (Trial columns added in Wave 7.1.1: `subscription_tier`, `trial_ends_at`).
- **Read patterns:** `profiles` is read for tier state on every middleware request (covered by Wave 7.2.1 middleware task).

### API

#### `POST /api/billing/trial/start`
- **Auth:** Supabase session cookie required (401 if absent).
- **Request body:** none.
- **Response:** `{ trial_ends_at: string }` (ISO timestamp) on 200; `{ error: string, reason: string }` on 409; 401 on unauthenticated.
- **Validation:** user must have `subscription_tier = 'free'` AND no existing `trial_ends_at` AND no `stripe_customer_id`.
- **Error codes:** 400 (unexpected body), 401, 409 (ineligible), 500 (DB error).

#### `GET /api/cron/expire-trials`
- **Auth:** `Authorization: Bearer <CRON_SECRET>` header (401 if missing or wrong).
- **Request:** no body.
- **Response:** `{ expired_count: number }` on 200.
- **Validation:** CRON_SECRET check before any DB operation.
- **Error codes:** 401, 500.

### UI

- **`CapHitPrompt` component:**
  - Props: `{ capType: 'entity' | 'reminder'; onStartTrial: () => void; onSeePlans: () => void }`
  - Accessibility: `role="alert"`, descriptive button labels, visible focus, sufficient contrast.

- **`PricingCard` component:**
  - Props: `{ tierName: string; monthlyPrice: number; annualPrice: number; features: string[]; isCurrent: boolean; ctaLabel: string; ctaHref?: string; onCTA?: () => void }`
  - Accessibility: CTA buttons are `<button>` or `<a>` with full labels; feature lists are `<ul>/<li>`.

- **`TrialBanner` component:**
  - Props: `{ trialEndsAt: Date }`
  - State: warning mode when days remaining ≤ 2; dismissed state via `sessionStorage`.
  - Accessibility: `aria-live="polite"`, icon + text for warning state (not color alone).

- **Pricing page (`/app/pricing/page.tsx`):**
  - Server component; reads auth session and `subscription_tier` from `profiles` if authenticated.
  - Reads `?reason=tier` from `searchParams` server-side.
  - No client-side data fetching for tier state.

### Testing

- **Unit tests:** `CapHitPrompt` — renders for both cap types; buttons call correct handlers.
- **Unit tests:** `PricingToggle` — monthly/annual switch updates all displayed prices correctly.
- **Unit tests:** trial start route — eligible, ineligible (already trialed), unauthenticated.
- **Unit tests:** trial expiry cron — updates expired trials, skips non-expired, skips paid subscribers.
- **Integration tests:** chat message with `reason: 'entity_cap'` renders `CapHitPrompt`; pricing page renders correct CTA state per tier.
- **Accessibility tests:** automated contrast and role checks (axe-core or equivalent) on `CapHitPrompt`, `TrialBanner`, pricing page.
- **Coverage target:** >80% branch coverage on trial route, cron route, and all billing UI components.

### Deployment

- No new env vars beyond those established in Wave 7.1.1.
- `vercel.json` cron config for `/api/cron/expire-trials`: `{ "path": "/api/cron/expire-trials", "schedule": "0 6 * * *" }` — runs at 06:00 UTC daily.

### Monitoring

- Log every `trial/start` activation (user_id, trial_ends_at) — structured.
- Log every trial expiry batch (count of expired profiles) from the cron job.
- Track conversion from trial to paid subscription (Stripe webhook on `customer.subscription.created` for a user who had `trial_ends_at` set) — this metric validates the cap-hit conversion thesis.
- Alert if `expire-trials` cron has not run successfully in 25 hours.

## Handoff Requirements

- Wave 7.1.1 complete: `subscription_tier`, `trial_ends_at`, Checkout route, Stripe webhook.
- Wave 7.2.1 complete: cap-hit tool result format (the structured `{ reason: 'entity_cap' }` response the prompt component consumes).
- Design tokens (colors, typography) from the Tailwind 4 configuration must be available to implement the warning banner state correctly.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Pricing not validated — beta users may not convert at $12/$22 | Medium — business | Medium | Launch as hypothesis (ADR-011 §19.5); instrument trial-start and trial→paid conversion; revisit pricing with beta data |
| Trial abuse — user creates new accounts to repeatedly trial | Low-Medium | Low | Rate-limit by email domain; require verified email before trial; acceptable at beta scale |
| Trial expiry cron misfires and downgrades a paying subscriber | High | Low | Cron explicitly filters `stripe_customer_id IS NULL`; paying subscribers are excluded |
| iOS Web Push not yet available (trial expiry notification) | Low | Medium | Trial banner in app header is the primary notification channel; Web Push is additive (Wave 7.5.1) |
| Pricing page accessible to unauthenticated visitors creates auth edge cases | Low | Low | Pricing page is a public route; middleware config excludes `/pricing` from auth redirect |

## Related Documentation

- Product Vision: `docs/architecture/_main/01-Product-Vision.md` §Go-to-Market, §Pricing Strategy
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` Feature 9, UC-22, UC-23
- UX: `docs/architecture/_main/05-User-Experience.md` §Error Handling UX (cap reached)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` Pass 5 (cap state), Pass 6 (tier limits must be visible)
- ADR-011: `docs/architecture/decisions/ADR-011-entity-cap-paywall-memory-window.md`
- Epic 7: `docs/implementation/_main/epic-7-productization.md`
- Wave 7.1.1: `docs/implementation/iterations/wave-7.1.1-stripe-billing-and-tiers.md`
- Wave 7.2.1: `docs/implementation/iterations/wave-7.2.1-tier-enforcement-middleware.md`
