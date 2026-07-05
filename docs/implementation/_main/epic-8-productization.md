---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-07-05T00:00:00"
version: "1.0"
type: epic
status: Planning
domain: implementation
product:
  - "coriven"
epic: "8"
priority: "Medium"
branch: "epic/8-productization"
architecture: ["ADR-011"]
tags: [coriven, billing, stripe, tiers, pwa, onboarding]
relateddocuments:
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
---

# Epic 8: Productization

## Epic Overview
- **Epic ID:** Epic-8
- **Status:** Planning
- **Duration:** Large
- **Team:** Solo (owner/developer)
- **Priority:** Medium (turns the personal tool into a product)

## Problem Statement

Coriven has been built personal-first but productizable-from-day-one (API-first, auth + `user_id` + RLS already in place). This Epic flips the switch: multi-user subscription billing, tier enforcement with the entity cap as the primary paywall, self-serve onboarding, and PWA + Web Push so reminders reach mobile. The conversion thesis: the moment Coriven "can't remember any more" is when the user feels the value most. See Product Vision §16 and blueprint §15, §16.

## Goals and Success Criteria

A new user can self-serve onboard, hit a contextual upgrade prompt at the value moment, subscribe via Stripe, and receive reminders on mobile.

**Success Metrics:**
- New user completes onboarding with a first goal + task.
- Free user sees the upgrade prompt at entity #10 (and the reminder cap at 1/day).
- Stripe subscription (Core/Pro) activates and gates tools/pages by `subscription_tier`.
- Memory-window limit enforced at retrieval by tier (24h / 7d / 30d), degrading gracefully.
- Mobile Web Push reminder fires via the PWA.

## Scope

### In Scope
- Stripe subscriptions (via MealPrepForge LLC / DBA) + `subscription_tier` on `profiles`.
- Tier-enforcement middleware: entity cap, reminder cap, memory window, page access.
- Entity-cap upgrade prompt; pricing page; $199 lifetime + 7-day no-CC trial flows.
- 4-step onboarding wizard (ends in a first goal + task).
- PWA (service worker, Web Push, add-to-home, offline context cache).

### Out of Scope
- Capacitor native iOS/Android (only if PWA usage shows demand — blueprint §15).
- Team/shared contexts (`org_id`) — blueprint §18.8.
- Tauri **Mac build + code-signing/notarization + release CI** — deferred here from Epic 6 (which shipped Windows-first, unsigned local; see ADR-014). Track and complete in this epic (or sooner if Mac demand arises).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 8.1: Stripe Billing & Tiers
- **Scope:** Stripe subscriptions through the MealPrepForge account as a second product line; `subscription_tier` (free/core/pro); webhooks; billing self-management.
- **Key Technical Approach:** Stripe Checkout + webhook (idempotent) updating `profiles.subscription_tier`; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` via env. Annual = 2 months free. See blueprint §16.
- **Requirements:** Business Requirements Feature 9, UC-14; Vision §16.3 tiers.
- **Dependencies:** Epic 1 (deploy + secrets).
- **Wave Planning:** Checkout wave + webhook wave.

### Feature 8.2: Tier Enforcement Middleware
- **Scope:** Enforce caps before tool execution / page access: entity cap (Free 10), reminder cap (Free 1/day), memory window (Free 24h / Core 7d / Pro 30d), tray scope.
- **Key Technical Approach:** Middleware checks `subscription_tier` before entity/reminder creation and page access; **memory window enforced at retrieval** by filtering memory age (Plan §19.6), degrading gracefully (older memories stop surfacing — not an error). See Architecture §"Authentication & Authorization."
- **Requirements:** Business Requirements Feature 9, UC-22/UC-23/UC-24; data governance (retention by tier).
- **Dependencies:** Feature 8.1; Epic 2 (memory window targets the retrieval path).
- **Wave Planning:** Enforcement wave + memory-window wave.

### Feature 8.3: Conversion UX (Prompts, Pricing, Trial)
- **Scope:** Contextual upgrade prompt at the entity/reminder cap; pricing page; $199 lifetime (first 200) + 7-day Core trial with **no credit card at signup** (trial triggers contextually at the cap).
- **Key Technical Approach:** Cap-hit detection surfaces the prompt at the value moment ("Coriven can't remember anyone else"); trial flow defers payment. See Vision §16.4–16.5; UX error/cap handling.
- **Requirements:** Business Requirements Feature 9; Vision §16.
- **Dependencies:** Features 7.1, 7.2.
- **Wave Planning:** Prompt wave + pricing/trial wave.

### Feature 8.4: Onboarding Wizard
- **Scope:** A 4-step wizard that ends with the user creating a first goal + task (zero-documentation first-run per UX Foundations Pass 6).
- **Key Technical Approach:** Guided flow reusing goal/task forms; suggested actions; lands on Today/Chat. See UX §"First-time user" flow.
- **Requirements:** Business Requirements UC-19; UX Foundations Pass 6.
- **Dependencies:** Epic 4 (goals exist).
- **Wave Planning:** One wave.

### Feature 8.5: PWA & Web Push
- **Scope:** Service worker, Web Push (Android Chrome + iOS Safari 16.4+), add-to-home, offline context cache — the mobile delivery surface.
- **Key Technical Approach:** Same backend; delivery shell changes (blueprint §15). Web Push replaces the tray on mobile. See Architecture §"Platform Strategy" / blueprint §15.
- **Requirements:** Business Requirements Feature 9 (PWA); Vision roadmap V3.
- **Dependencies:** Epic 1; reminder/briefing endpoints (Epics 1, 4).
- **Wave Planning:** PWA-shell wave + Web-Push wave.

## Dependencies

**Prerequisites:** Epic 1 (deploy). Strong: Epic 2 (memory window), Epic 4 (goals for onboarding).
**Enables:** Public launch; revenue; mobile reach.
**External Dependencies:** Stripe, Web Push (browser push services), MealPrepForge LLC/DBA + Missouri fictitious-name registration.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Pricing unvalidated | Med | Med | Launch with stated tiers (§19.5); revisit with beta data |
| Memory-window enforcement feels "broken" | Med | Med | Enforce at retrieval; degrade gracefully; clear messaging |
| Stripe webhook reliability | Med | Low | Idempotent handlers; reconcile on read |
| iOS Web Push limitations | Med | Med | Target Safari 16.4+; document; Capacitor only if demand |

## Technical Considerations

The personal→product path is a config change, not a rewrite (RLS multi-tenancy already done). The entity cap is the load-bearing paywall assumption. Backend is identical across surfaces; only the delivery shell changes (blueprint §15).

## Compliance and Security

Billing via MealPrepForge LLC (DBA). PCI handled by Stripe (no card data stored). GDPR-style data export + account deletion exposed here (Privacy/Data manager role). Tier checks are authorization controls.

## Related Documentation
- Product Vision: docs/architecture/_main/01-Product-Vision.md (§Monetization)
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Feature 9)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§15, §16, §19)

## Architecture Decision Records (ADRs)
- ADR-011: Entity cap as the primary paywall; memory window enforced at retrieval

---
**Template Version:** 2.0 (3-layer, embedded features)
