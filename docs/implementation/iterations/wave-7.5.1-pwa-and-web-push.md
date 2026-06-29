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
feature: "7.5"
wave: "7.5.1"
agents: []
tags: [coriven, pwa, service-worker, web-push, vapid, offline, mobile, add-to-home]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/05-User-Experience.md"
---

# Wave 7.5.1: PWA and Web Push

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.5.1 |
| Feature | 7.5 — PWA and Web Push |
| Epic | 7 — Productization |
| Status | Planning |
| Scope | PWA shell (service worker, web app manifest, add-to-home-screen); Web Push subscription storage and VAPID-based push delivery; offline context cache for basic chat context; integration of reminders and briefings into the Web Push delivery path — replacing the tray daemon on mobile. |
| Wave Goal | A user on Android Chrome or iOS Safari 16.4+ can install Coriven as a PWA, grant push permissions, and receive a due reminder as a Web Push notification — confirming that mobile delivery is live and that the backend is identical to the desktop path. |

**Wave Philosophy:** Scope-based — this wave closes when a real device receives a Web Push for a due reminder and the add-to-home-screen prompt is verified; no schedule.

## Wave Goals

1. The Next.js app is a fully registered PWA (manifest, service worker, installability) on Android Chrome and iOS Safari 16.4+; add-to-home-screen prompt fires per platform capability — satisfying Vision §V3 roadmap and Architecture §Platform Strategy ("same backend; only the delivery shell changes").
2. A Coriven user can grant Web Push permission from a browser prompt; their push subscription is stored per-device; due reminders and daily briefings are pushed via VAPID to subscribed devices, replacing the Windows tray on mobile (the tray remains on desktop).
3. The service worker caches the last-known context (entity list and active goals) so a user who opens the PWA offline sees a degraded but functional shell rather than a blank error screen — all offline reads are stale-cache reads, not live data.

## User Stories

---

### Story 7.5.1.1 — PWA Shell: Service Worker, Manifest, and Installability

**As a** user on a mobile browser,
**I want** to install Coriven to my home screen and have it open as a standalone app,
**So that** I have a native-like experience without downloading from an app store.

**Reference:** Business Requirements Feature 9 (PWA); Architecture §Platform Strategy; Vision §V3 Advanced Features.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- A `manifest.webmanifest` is served at `/manifest.webmanifest` with: `name: "Coriven"`, `short_name: "Coriven"`, `start_url: "/"`, `display: "standalone"`, `background_color`, `theme_color`, icons at 192x192 and 512x512 (SVG or PNG).
- A service worker is registered by the Next.js app on first load; it does not interfere with auth cookies or Supabase session management.
- Chrome on Android shows the "Add to Home Screen" prompt (meets installability criteria: manifest + HTTPS + service worker).
- iOS Safari 16.4+ shows "Add to Home Screen" via the share sheet; the installed icon and name are correct.
- The service worker version is bumped on each deploy (cache busting); stale workers are replaced within one page lifecycle.
- Lighthouse PWA audit passes the installability and service worker checks.
- The service worker does NOT cache API routes or Supabase auth requests (auth must always go to the network).

---

#### Task 7.5.1.1.1 — Web App Manifest

| Field | Value |
|---|---|
| Parent Story | 7.5.1.1 |
| Agent | frontend-specialist |
| Estimation | 4h |
| Dependencies | None |
| Deliverables | `apps/web/public/manifest.webmanifest`; app icons at 192x192 and 512x512; updated `apps/web/src/app/layout.tsx` `<head>` with manifest link and `theme-color` meta |

**Acceptance Criteria:**
- Manifest validates against the W3C Web App Manifest spec (no required fields missing).
- Icons exist as PNG or SVG at the specified sizes; they render correctly on Android home screen and iOS share sheet.
- `start_url: "/"` is the authenticated entry point; `display: "standalone"` removes browser chrome.
- `theme-color` matches the app's primary color (from Tailwind config); `background_color` matches the app shell background.
- Manifest link and `theme-color` meta are in `<head>` via Next.js `metadata` API, not hardcoded HTML.

---

#### Task 7.5.1.1.2 — Service Worker Registration and Offline Shell

| Field | Value |
|---|---|
| Parent Story | 7.5.1.1 |
| Agent | frontend-specialist |
| Estimation | 8h |
| Dependencies | Task 7.5.1.1.1 |
| Deliverables | `apps/web/public/sw.js`; service worker registration in `apps/web/src/app/layout.tsx` (or a `ServiceWorkerRegistration` client component); offline fallback page at `apps/web/src/app/offline/page.tsx` |

**Acceptance Criteria:**
- Service worker is registered from a client component with `navigator.serviceWorker.register('/sw.js')` — no third-party SW library required.
- The SW caches static Next.js assets (JS chunks, CSS) on install using a cache-first strategy.
- API routes (`/api/*`), Supabase requests (`*.supabase.co`), and auth routes are explicitly excluded from caching (network-only).
- A navigated offline request that misses the cache serves the `/offline` fallback page, which renders: "You're offline — your last-known context is shown below" and the cached entity list (Story 7.5.1.3).
- On each new deploy, the SW version string changes; the old SW is replaced within one page lifecycle (activate event claims clients).
- Verified: installing the SW does not break auth cookie flow or Supabase session refresh.

---

### Story 7.5.1.2 — Web Push Subscription and VAPID Delivery

**As a** Coriven user on mobile,
**I want** to grant push notification permission once,
**So that** I receive due reminders and my daily briefing as native push notifications even when the app is not open.

**Reference:** Business Requirements Feature 9; Architecture §Platform Strategy; Vision §V3.

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- A permission prompt is shown in the app UI (not triggered on page load — user initiates from Settings or a contextual prompt); clicking "Allow notifications" calls `Notification.requestPermission()` then subscribes via `registration.pushManager.subscribe(...)` with the VAPID public key.
- The push subscription (`endpoint`, `p256dh`, `auth`) is sent to `POST /api/push/subscribe` and stored in a `push_subscriptions` table with `user_id` and `device_fingerprint`.
- The server sends Web Push notifications using VAPID keys from `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env vars — never hardcoded.
- When a reminder becomes due (detected by the existing due-reminder cron or polling path), a push notification is sent to all subscribed devices for that user with title (task title) and body ("Due now — Tap to open Coriven").
- The notification is actionable: tapping it opens the Coriven PWA at the Tasks page.
- A failed push (410 Gone — subscription expired) removes the subscription row from `push_subscriptions`.
- iOS Safari 16.4+ compatibility: Web Push subscription is tested on a real iOS device or BrowserStack; known limitation (requires the PWA to be installed first) is documented.
- VAPID keys are generated once and stored as env vars; no key rotation is required at this wave.

---

#### Task 7.5.1.2.1 — Push Subscriptions Table and Subscribe Route

| Field | Value |
|---|---|
| Parent Story | 7.5.1.2 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | None |
| Deliverables | `supabase/migrations/<timestamp>_add_push_subscriptions.sql`; `apps/web/src/app/api/push/subscribe/route.ts`; `apps/web/src/app/api/push/unsubscribe/route.ts` |

**Acceptance Criteria:**
- `push_subscriptions` table: `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `endpoint text NOT NULL`, `p256dh text NOT NULL`, `auth text NOT NULL`, `device_fingerprint text`, `created_at timestamptz DEFAULT now()`.
- RLS: users can SELECT/DELETE their own rows; INSERT is via service-role (server only, never anon).
- `UNIQUE (user_id, endpoint)` constraint prevents duplicate subscriptions.
- `POST /api/push/subscribe` accepts `{ subscription: PushSubscriptionJSON }` and upserts the row.
- `POST /api/push/unsubscribe` accepts `{ endpoint: string }` and deletes the matching row for the authenticated user.
- Both routes require authentication (401 if absent).
- TypeScript types regenerated.

---

#### Task 7.5.1.2.2 — VAPID Push Utility and Reminder Delivery

| Field | Value |
|---|---|
| Parent Story | 7.5.1.2 |
| Agent | backend-specialist |
| Estimation | 8h |
| Dependencies | Task 7.5.1.2.1; existing due-reminder detection path (Epic 1) |
| Deliverables | `apps/web/src/lib/push/send.ts` — exported `sendPushToUser(userId, payload)`; extended due-reminder cron or polling route to call `sendPushToUser` |

**Acceptance Criteria:**
- `sendPushToUser` loads all `push_subscriptions` rows for the user, sends a Web Push payload to each using the `web-push` npm package with VAPID keys from env vars.
- On 410 (subscription expired) or 404 response from the push service, the subscription row is deleted.
- On 429 (rate limited) or 5xx from the push service, the send is logged as a warning and retried on the next poll cycle (no immediate retry loop).
- VAPID subject is set to `mailto:<owner email>` from env var.
- `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are read exclusively from env vars; no key material appears in code.
- Payload: `{ title: taskTitle, body: 'Due now — Tap to open Coriven', data: { url: '/tasks' } }`.
- The due-reminder cron (or polling route) calls `sendPushToUser` after firing a reminder notification for the tray — both channels fire for the same event.
- Unit test: mock `web-push.sendNotification`; assert 410 response removes subscription; assert payload structure.

---

#### Task 7.5.1.2.3 — Push Permission UI in Settings

| Field | Value |
|---|---|
| Parent Story | 7.5.1.2 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.5.1.2.1; Settings page |
| Deliverables | `apps/web/src/components/settings/PushPermissionControl.tsx`; updated Settings > Notifications section |

**Acceptance Criteria:**
- `PushPermissionControl` is a client component that shows:
  - "Notifications not supported" if the browser does not support the Push API.
  - "Enable notifications" button if `Notification.permission === 'default'`.
  - "Notifications enabled" with a "Disable" button if `Notification.permission === 'granted'` and a subscription exists.
  - "Notifications blocked — update your browser settings" if `Notification.permission === 'denied'`.
- Clicking "Enable notifications" calls `Notification.requestPermission()` → on 'granted', subscribes with the VAPID public key → POSTs to `/api/push/subscribe`.
- "Disable" calls `registration.pushManager.getSubscription()` → unsubscribes → POSTs to `/api/push/unsubscribe`.
- WCAG AA: button labels describe the action; state changes are announced via `aria-live="polite"`.
- On iOS where Web Push requires the PWA to be installed, a helper text "Install Coriven to your home screen first to enable notifications" is shown if the browser is Mobile Safari and `window.navigator.standalone === false`.

---

### Story 7.5.1.3 — Daily Briefing via Web Push

**As a** mobile user who has granted push permission,
**I want** to receive my daily briefing as a push notification each morning,
**So that** I am oriented to my goals and tasks for the day without opening the app.

**Reference:** Business Requirements Feature 9; Architecture §Cron Jobs; Vision §V3.

**Priority:** High
**Estimated hours:** 6

**Acceptance Criteria:**
- The existing briefing cron (Epic 3) is extended to call `sendPushToUser` after writing the `daily_briefings` row.
- Push payload: `{ title: "Good morning, [name]", body: "Your briefing is ready — 3 goals in motion, 2 tasks due today.", data: { url: '/today' } }`.
- Tapping the notification opens the PWA at `/today`.
- Push fires at the user's configured briefing time (timezone-aware, as implemented by the briefing cron).
- If the user has no push subscriptions, the push send is skipped silently (no error).
- Unit test: briefing cron path with a subscribed user calls `sendPushToUser`; with no subscriptions, no call is made and no error is thrown.

---

#### Task 7.5.1.3.1 — Extend Briefing Cron with Push Delivery

| Field | Value |
|---|---|
| Parent Story | 7.5.1.3 |
| Agent | backend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.5.1.2.2; Epic 3 briefing cron (must exist) |
| Deliverables | Modified briefing cron route; unit tests |

**Acceptance Criteria:**
- After the `daily_briefings` row is written and `was_delivered` is set, the cron calls `sendPushToUser(userId, briefingPayload)`.
- `briefingPayload.body` is constructed from the briefing content (number of goals in motion, tasks due today) — a short summary string, not the full briefing text.
- Errors from `sendPushToUser` are logged but do not mark the briefing as undelivered (push delivery is a best-effort secondary channel; tray remains the primary for desktop).
- Existing tray delivery path is unchanged.

---

### Story 7.5.1.4 — Offline Context Cache in the Service Worker

**As a** user who opens the Coriven PWA with no network,
**I want** to see a degraded but useful view showing my last-known entities and active goals,
**So that** I am not presented with a blank screen or an error when temporarily offline.

**Reference:** Architecture §Reliability (Tray offline → cached payload); Vision §Platform Strategy (offline context cache).

**Priority:** Medium
**Estimated hours:** 6

**Acceptance Criteria:**
- After a successful authenticated app load, the service worker fetches and caches a "context snapshot": the user's entity list and active goals from a dedicated `GET /api/context/snapshot` endpoint.
- The snapshot cache is refreshed on each successful app load (cache TTL: 24 hours as a hard maximum, but refreshed more frequently on each load).
- When the user opens the PWA offline, the offline fallback page reads from the context snapshot cache and renders: a list of entity names and a list of active goal titles with a "You're offline" banner.
- Sensitive data (conversation history, memory details) is NOT cached by the service worker — only the entity list and goal titles.
- The snapshot endpoint requires authentication; if unauthenticated, it returns 401 and nothing is cached.
- The cached data is stored in the Cache API (not localStorage), keyed by `context-snapshot-v1`.

---

#### Task 7.5.1.4.1 — Context Snapshot Endpoint and Service Worker Caching

| Field | Value |
|---|---|
| Parent Story | 7.5.1.4 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Epic 2 (entity_profiles table); Epic 4 (goals table) |
| Deliverables | `apps/web/src/app/api/context/snapshot/route.ts`; updated `apps/web/public/sw.js` cache strategy |

**Acceptance Criteria:**
- `GET /api/context/snapshot` returns `{ entities: [{ name, type }], goals: [{ title, status }] }` — minimal fields only.
- Auth required (401 if unauthenticated); uses auth-server Supabase client.
- Response is cacheable (`Cache-Control: private, max-age=86400`).
- Service worker caches the response under `context-snapshot-v1` on each app load.
- Offline fallback page reads from `context-snapshot-v1` cache and renders the entity and goal lists.
- If the cache is empty (first install, no prior load), the offline page shows "No cached data available — connect to the internet to load Coriven."

---

#### Task 7.5.1.4.2 — Offline Fallback Page

| Field | Value |
|---|---|
| Parent Story | 7.5.1.4 |
| Agent | frontend-specialist |
| Estimation | 4h |
| Dependencies | Task 7.5.1.4.1; Task 7.5.1.1.2 (offline page exists as a placeholder) |
| Deliverables | Updated `apps/web/src/app/offline/page.tsx` with context display |

**Acceptance Criteria:**
- Offline page is a client component that reads `context-snapshot-v1` from the Cache API on mount.
- Displays "You're offline" banner with a "Retry" button that calls `window.location.reload()`.
- If snapshot data is available, renders entity names under "People I know" and goal titles under "Active goals."
- Conversation history, memory details, and task details are NOT shown (not cached).
- WCAG AA: offline banner uses `role="alert"`; retry button has a visible focus ring; text contrast meets AA.

---

## Task Dependencies

```
Task 7.5.1.1.1 (manifest)
  └── Task 7.5.1.1.2 (service worker + offline shell)
       └── Task 7.5.1.4.2 (offline fallback page with context)

Task 7.5.1.2.1 (push subscriptions table + routes)
  └── Task 7.5.1.2.2 (VAPID push utility + reminder delivery)
       └── Task 7.5.1.3.1 (briefing cron push extension)
  └── Task 7.5.1.2.3 (push permission UI in Settings)

Task 7.5.1.4.1 (context snapshot endpoint + SW cache strategy)
  └── Task 7.5.1.4.2 (offline fallback page)

Parallelizable streams:
  - Manifest + SW shell (7.5.1.1.x) can run concurrently with push subscription setup (7.5.1.2.1)
  - Context snapshot work (7.5.1.4.x) can run concurrently with push delivery (7.5.1.2.2+)
```

**Critical path:** manifest → service worker → push subscription table → VAPID utility → reminder delivery.
**Parallelizable:** PWA shell tasks and push subscription table can start simultaneously.

## Definition of Done

- PWA installability: Lighthouse PWA audit passes; Chrome Android shows add-to-home prompt; iOS Safari 16.4+ can install via share sheet.
- Service worker registered; static assets cached; auth routes excluded; stale SW replaced on deploy.
- Push subscription stored in `push_subscriptions`; VAPID keys from env vars; push delivered to a real device (Android Chrome verified; iOS Safari 16.4+ verified or documented as tested on BrowserStack).
- Due reminder fires both via tray (desktop) and Web Push (mobile) for the same event.
- Daily briefing push fires at the user's configured briefing time.
- Expired subscriptions (410 Gone) are removed from `push_subscriptions`.
- Offline fallback page displays last-known entity list and goal titles from cached context snapshot.
- WCAG AA: push permission UI, offline page, all new components verified.
- Unit tests: push send utility (410 cleanup, payload structure), subscribe/unsubscribe routes, context snapshot route, offline page cache read.
- CI test suite passes; no auth regressions from service worker.

## Infrastructure Specifications

### Database

- **New table: `push_subscriptions`**
  - Migration name: `<timestamp>_add_push_subscriptions`
  - Columns: `id uuid PK DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `endpoint text NOT NULL`, `p256dh text NOT NULL`, `auth text NOT NULL`, `device_fingerprint text`, `created_at timestamptz DEFAULT now()`
  - Constraints: `UNIQUE (user_id, endpoint)`
  - RLS: SELECT/DELETE for own user_id; INSERT via service-role only.
  - Index: `CREATE INDEX ON push_subscriptions (user_id)` for fast lookup by user.

### API

#### `POST /api/push/subscribe`
- **Auth:** Supabase session cookie (401 if absent).
- **Request:** `{ subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; deviceFingerprint?: string }`
- **Response:** `{ id: string }` on 201; 200 on upsert.
- **Validation:** endpoint must be a valid URL; keys must be present.

#### `POST /api/push/unsubscribe`
- **Auth:** Supabase session cookie (401 if absent).
- **Request:** `{ endpoint: string }`
- **Response:** 200 on success; 404 if not found.

#### `GET /api/context/snapshot`
- **Auth:** Supabase session cookie (401 if absent).
- **Response:** `{ entities: Array<{ name: string; type: string }>; goals: Array<{ title: string; status: string }> }`
- **Cache-Control:** `private, max-age=86400`
- **Validation:** no request body; user derived from session.
- **Error codes:** 401, 500.

### UI

- **`PushPermissionControl` component:**
  - Client component; reads `Notification.permission` on mount.
  - State machine: unsupported → default → requesting → granted | denied.
  - VAPID public key read from `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var (safe for client exposure).

- **Service worker (`/public/sw.js`):**
  - Cache strategy: install → cache static assets; fetch → cache-first for static, network-only for `/api/*` and `*.supabase.co`; context snapshot → cache on each authenticated app load.
  - Push event handler: `self.addEventListener('push', ...)` → `self.registration.showNotification(...)`.
  - Notification click handler: `self.addEventListener('notificationclick', ...)` → `clients.openWindow(data.url)`.

- **Offline page (`/offline`):**
  - Client component; reads Cache API on mount; renders entity and goal lists or empty state.

### Testing

- **Unit tests:** `send.ts` — 410 cleanup, 429 no-op, payload format; all via mocked `web-push`.
- **Unit tests:** subscribe route — upsert on duplicate endpoint, 401 on missing auth.
- **Unit tests:** context snapshot route — returns correct shape, 401 on no session.
- **Unit tests:** briefing cron with push — sends push when subscriptions exist; no error when empty.
- **Unit tests:** `PushPermissionControl` — renders correct state for each `Notification.permission` value; iOS install hint shown when standalone is false.
- **Integration tests:** subscribe → verify DB row; unsubscribe → verify row deleted; 410 → verify row deleted.
- **Device testing (manual):** Android Chrome: install PWA, grant push, receive reminder notification; iOS Safari 16.4+: install PWA, grant push, receive notification (or document BrowserStack result).
- **Coverage target:** >80% branch coverage on `push/send.ts`, push routes, and context snapshot route.

### Deployment

- **New env vars:**
  - `VAPID_PRIVATE_KEY` (server-only — never expose)
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (safe for client)
  - `VAPID_SUBJECT` (e.g., `mailto:ltroylove@outlook.com`)
- **VAPID key generation:** `npx web-push generate-vapid-keys` — run once; store output in Vercel env vars and `.env.local`.
- **Service worker:** served from `public/sw.js` as a static file; Next.js serves public dir at the root; no webpack plugin required for a hand-authored SW.
- **PWA manifest:** served from `public/manifest.webmanifest`; linked from `layout.tsx` via Next.js `<link>` in `<head>`.

### Monitoring

- Log every push send attempt (user_id, endpoint hash, status code) — structured; endpoint is hashed (not logged raw) for privacy.
- Log every 410 cleanup (user_id, endpoint hash removed).
- Track Web Push delivery rate (sent vs 410/error) per user — identify stale subscription accumulation.
- Alert if the due-reminder push error rate exceeds 10% for more than 1 hour.
- Track PWA install events via `beforeinstallprompt` → accepted/dismissed in analytics (if analytics is wired; log to console at minimum).

## Handoff Requirements

- VAPID keys generated and stored in Vercel project env vars and `.env.local` before Task 7.5.1.2.2.
- Epic 3 briefing cron must exist before Task 7.5.1.3.1.
- Epic 2 entity_profiles table and Epic 4 goals table must exist before Task 7.5.1.4.1.
- A real Android device (or BrowserStack) is required for push notification E2E verification.
- iOS Safari 16.4+ device or BrowserStack required for iOS push verification.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| iOS Web Push requires PWA to be installed first — users may not know this | Medium | High | `PushPermissionControl` shows install-first hint on Mobile Safari when not in standalone mode |
| iOS Safari Web Push may require additional entitlement or configuration per Apple's implementation | Medium | Medium | Test against the Apple Push Notification service (APNs-backed Web Push on iOS 16.4+); document any known gaps; Capacitor native is out of scope |
| Service worker interfering with Supabase auth cookies | High | Medium | Explicitly exclude auth routes and Supabase domains from the SW cache; test auth flow with SW active |
| VAPID key rotation in the future (if keys are compromised) | Medium | Low | All subscriptions would need to be re-requested; document the re-subscription procedure; acceptable risk at launch scale |
| Push notification delivery not guaranteed (browser can throttle) | Low | Medium | Web Push is best-effort; tray remains the primary delivery channel on desktop; document limitation |
| Vercel Edge Runtime limitations for the context snapshot endpoint | Low | Low | Use Node.js runtime for this route (not edge); annotate with `export const runtime = 'nodejs'` if needed |

## Related Documentation

- Product Vision: `docs/architecture/_main/01-Product-Vision.md` §V3 Advanced Features, §Platform Strategy
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` Feature 9
- Architecture: `docs/architecture/_main/04-Architecture.md` §Platform Strategy, §Reliability
- UX: `docs/architecture/_main/05-User-Experience.md` §Responsive Design (Mobile/PWA)
- Epic 7: `docs/implementation/_main/epic-7-productization.md`
- Wave 7.1.1: `docs/implementation/iterations/wave-7.1.1-stripe-billing-and-tiers.md`
