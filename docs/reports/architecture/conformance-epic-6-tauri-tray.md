---
preparedby: "architecture-review agent"
datecreated: "2026-07-04"
type: report
domain: architecture
product:
  - "coriven"
epic: "6"
branch: "epic/6-tauri-tray"
architecture: ["ADR-003", "ADR-012", "ADR-013", "ADR-014"]
tags: [coriven, tray, tauri, conformance, review, advisory]
---

# Architecture Conformance Review — Epic 6: Tauri Tray

**Scope:** All 6 waves (6.1.1 → 6.3.2) as committed on `epic/6-tauri-tray`.
**Nature:** Advisory, not blocking (per architectural-conformance-validation skill).
**Limits:** Runtime behavior could not be verified in this environment — findings are static-analysis/compile-gated only. **Manual Windows smoke-testing remains the pending gate** (unsigned local build, per ADR-014).

---

## 1. Per-Area Status Summary

| # | Area | Status |
|---|------|--------|
| 1 | Thin-shell conformance (ADR-003 / blueprint §13.2) | **Conformant** |
| 2 | Endpoint consumption (incl. `/api/approvals/pending` metadata-only) | **Conformant** (contract shape) / **Critical integration defect** (auth transport — see D-1) |
| 3 | ADR-014 (Windows-first, unsigned, deferred Mac/signing/CI/PKCE) | **Conformant** |
| 4 | Feature completeness (6.1 / 6.2 / 6.3) | **Partial** — notification-click action path not wired (D-2) |
| 5 | Monorepo / structure conformance | **Conformant** |
| 6 | Cross-wave coherence | **Conformant** with minor duplication (D-4) |

**Overall PR-readiness: NOT READY as-is.** One Critical integration defect (D-1) makes every runtime acceptance criterion unachievable against the current backend; one Critical completeness gap (D-2) makes per-reminder Snooze/Dismiss unreachable from a toast. Both are bounded fixes. Everything architectural — the load-bearing thin-shell principle, ADR-014 deferral discipline, endpoint whitelisting, monorepo hygiene — is in good shape.

---

## 2. Thin-Shell Verification (the load-bearing principle) — CONFORMANT

Verified by inspection of every Rust module and the bundled webview:

- **No DB / Supabase data access in the shell.** `Cargo.toml` has no Supabase, no postgres, no DB crate — only `reqwest`, `tokio`, `serde`, `chrono`, `keyring`, `png`, and Tauri plugins (`apps/tray/src-tauri/Cargo.toml:19-39`). The webview's `supabase-js` is used **exclusively for auth** (`signInWithPassword`, `getSession`, `refreshSession` rotation, `signOut`) — no `.from()` / data queries anywhere in `apps/tray/dist/index.html`.
- **No recurrence math, no `getNextOccurrence` duplication.** The only occurrence concept is the de-dup key built verbatim from API fields: `snoozed_until ?? remind_at` (`apps/tray/src-tauri/src/poll.rs:82-96`). No date arithmetic beyond one comparison.
- **The only "due" decision is fire-time ≤ clock**, exactly as permitted: `is_at_or_before_now` (`poll.rs:626-636`), used at `poll.rs:351-354`. The API's 24h window means this is presentation timing, not a business rule — matching Wave 6.2.1's Notes and the epic's Technical Considerations.
- **No "what's due" rules, no briefing assembly, no approval logic.** Briefing module reads only `id`, `briefing_date`, `was_delivered` and explicitly ignores `content` (`briefing.rs:40-52`); the toast is generic text (`briefing.rs:245-246`). Approvals module renders only `action_type`/`provider` metadata and count (`approvals.rs:205-227`). Snooze semantics are minutes POSTed to the backend; dismiss is local presentation suppression only, documented as such (`actions.rs:54-64`).
- **Local state is presentation-only:** de-dup cache (`notified-cache.json`), due-payload cache (`due-cache.json`), snooze retry queue (`snooze-queue.json`) — ids, timestamps, titles; no tokens (`offline.rs:28-44,128-137`).
- Thin-shell constraint headers appear in every module and in `main.rs:4-8`; `lib.rs:1-8` declares violation a review-gate failure.

**No leaked business logic found.** The prior Node daemon's sins (direct `task_reminders` queries, duplicated `getNextOccurrence`) are not repeated.

---

## 3. Endpoint Consumption — CONFORMANT shape, with one Critical integration defect

The tray consumes exactly the four blueprint §13.2 endpoints and nothing else:

| Endpoint | Tray consumer | Backend |
|---|---|---|
| `GET /api/tasks/due` | `poll.rs:283,567-597` | `apps/web/src/app/api/tasks/due/route.ts` |
| `POST /api/tasks/[id]/snooze` | `offline.rs:226-274` | `apps/web/src/app/api/tasks/[id]/snooze/route.ts` |
| `GET /api/briefing/today` (+ `X-Mark-Delivered`) | `briefing.rs:107-150` | `apps/web/src/app/api/briefing/today/route.ts:51-72` |
| `GET /api/approvals/pending` | `approvals.rs:135-172` | `apps/web/src/app/api/approvals/pending/route.ts` |

- **The one new backend artifact conforms to ADR-013:** `/api/approvals/pending` whitelist-selects only `id, action_type, provider, created_at` — `payload` and `ai_summary` are structurally never queried (`route.ts:34-38`), RLS-scoped via `createAuthServerClient`, empty queue returns `200 {count:0, items:[]}` not 404. Typed against `PendingApprovalsResponse` in `packages/types/src/approval.ts:116-119`. Exactly what the epic and Wave 6.3.1 specified.
- Response shapes in Rust mirror the actual routes (field names confirmed against `due/route.ts` select and the briefing envelope) and malformed responses are rejected wholesale (`poll.rs:589-596`).

### D-1 (CRITICAL): Auth transport mismatch — Bearer tokens are never honored by the backend

The tray authenticates every call with `Authorization: Bearer <access_token>` (`poll.rs:574-577`, `offline.rs:236-239`, `briefing.rs:115-118`, `approvals.rs:142-146`). But:

- All four consumed routes authenticate via `createAuthServerClient()`, which is **cookie-only** (`apps/web/src/lib/supabase/auth-server.ts:11-35` — `@supabase/ssr` + Next `cookies()`); none reads the `Authorization` header. A grep of `apps/web/src` confirms the only Bearer handling anywhere is the `CRON_SECRET` cron routes and outbound provider calls.
- Worse, `apps/web/src/middleware.ts:38-43` **redirects** any request without a cookie session to `/signin` (the matcher covers `/api/*` except `/api/auth`). A tray request would receive a 302 → the sign-in HTML with 200, which the tray parses as `ParseError` and treats as offline — it would never even see a 401, so the refresh path is moot.

Consequence: as built, the tray **cannot authenticate against the current backend at all**; every Feature 6.2/6.3 runtime acceptance criterion fails on first contact. Wave 6.2.1's Infrastructure section asserted "`GET /api/tasks/due` … Auth: Supabase bearer token. The tray consumes this endpoint as-is; no backend changes in this wave" — that assumption is false against the actual code and was never validated. This is exactly what the pending Windows smoke test would surface immediately.

**Recommendation:** Either (a) add Bearer-token support to the four routes (e.g., a shared helper that passes the header JWT to `supabase.auth.getUser(jwt)` when present, falling back to cookies) plus a middleware bypass/401-instead-of-redirect for `Authorization`-bearing `/api/*` requests, or (b) have the tray adopt cookie-session auth. Option (a) is the architecturally cleaner fit for a thin API client and for future mobile. Record the choice (an ADR-014 addendum or a short ADR-015 "API auth for non-browser clients" would be appropriate, since this defines the tray↔API auth contract).

---

## 4. ADR-014 Conformance — CONFORMANT (deferred cleanly, not half-implemented)

- **Windows-first, cross-platform source:** `tauri.conf.json` bundles `["nsis","msi"]` only; no Mac bundle config, no `.app` targets. The only Mac touchpoint is the autostart plugin's `MacosLauncher::LaunchAgent` parameter (`lib.rs:51-54`) — a required plugin argument, not a Mac build. Capabilities declare all three platforms (`capabilities/default.json:5`) which keeps the source cross-platform per ADR-014's "packaging decision, not a code decision."
- **Unsigned local build:** `bundle.windows.certificateThumbprint: null` (`tauri.conf.json:35`); no signing config anywhere.
- **No release CI:** no `.github/workflows/` exists in the repo. Build is local (`npm run tray:build`). Conformant with "local dev build only this epic."
- **PKCE correctly ABSENT, not half-implemented:** no OAuth/localhost-callback/PKCE code anywhere. Auth is the interim pattern exactly as specified: email+password sign-in in the webview, **refresh token persisted only via OS keychain** (`keyring` crate, Windows Credential Manager — `secure_store.rs:16-23`), access token in Rust memory only, never persisted/logged (`auth.rs:1-9,31-38`). The webview's custom Supabase storage adapter persists *only* the `refresh_token` field to the keychain and keeps everything else in a memory Map (`dist/index.html:428-477`) — a notably faithful implementation of the epic's security section.
- SmartScreen/unsigned caveats and the Epic-8 deferrals are documented in code comments and configs rather than partially built. No violations found.

---

## 5. Feature-Completeness Matrix

Legend: ✔ shipped and conformant · ◐ shipped with a gap · ✘ missing

### Feature 6.1 — Tauri Shell, Auth & Autostart (waves 6.1.1, 6.1.2)

| Acceptance item | Status | Evidence |
|---|---|---|
| `apps/tray/` Tauri v2 scaffold, Rust core + webview | ✔ | `src-tauri/` modules; `tauri.conf.json` |
| Tray icon + menu (Open App / Snooze All / Quit) | ✔ | `lib.rs:152-277` (plus Sign In/Out, Toggle Autostart) |
| No primary window | ✔ | `tauri.conf.json` `"windows": []`; sign-in window created on demand (`lib.rs:281-307`) |
| Supabase sign-in in webview | ✔ | `dist/index.html:561-593` |
| Refresh token → Tauri secure storage (keychain) | ✔ | `secure_store.rs`; adapter `index.html:428-477` |
| Session restore on startup; revoked → re-prompt | ✔ | `index.html:617-645` |
| Autostart on login (plugin) + toggle | ✔ | `lib.rs:51-54,232-255`; UI toggle + auto-enable on first sign-in `index.html:531-543,576-584` |

### Feature 6.2 — Reminder Poll & Native Notifications (waves 6.2.1, 6.2.2)

| Acceptance item | Status | Evidence |
|---|---|---|
| Poll `GET /api/tasks/due` ~5 min + startup | ✔ | `poll.rs:33,227-240` |
| Native toast per due reminder (title + time) | ✔ | `poll.rs:340-374`, `notify.rs:56-78` |
| De-dup by reminder id + occurrence, persisted, pruned | ✔ | `poll.rs:82-194`; survives restart; pruned per cycle |
| Snooze 15m / 1h / Dismiss actions | ◐ | Handler + picker window + webview UI exist (`actions.rs`, `notify.rs:163-198`, `index.html:242-398`) but nothing opens the picker — see **D-2** |
| Snooze → `POST /api/tasks/[id]/snooze` | ✔ | `offline.rs:226-274`; contract `{minutes}` matches route |
| Snooze All from tray menu | ✔ | `lib.rs:207-231`, `actions.rs:274-335` (partial-failure tolerant) |
| Offline → fire from last cached payload; reconcile on reconnect | ✔ | `offline.rs:37-99`; queue flush `poll.rs:501-557`; cancelled-while-offline covered by prune (tested `poll.rs:861-879`) |
| 401 → token refresh path | ◐ | Rust emits `coriven://auth/refresh-needed` (`poll.rs:308`) but no webview listener exists — see **D-3** |

### Feature 6.3 — Briefing & Approval Delivery (waves 6.3.1, 6.3.2)

| Acceptance item | Status | Evidence |
|---|---|---|
| New `GET /api/approvals/pending`, RLS, metadata-only | ✔ | `apps/web/.../approvals/pending/route.ts`; ADR-013 whitelist structural |
| Briefing poll on startup + recurring; delivered flag respected | ✔ | Runs every cycle incl. startup (`poll.rs:390-395`) — a superset of "startup + configured time"; server `was_delivered` is source of truth (`briefing.rs:229-231`) |
| Exactly-once briefing (server flag + session guard + mark-delivered round-trip) | ✔ | `briefing.rs:195-293,316-318`; offline edge documented and tested |
| Approval notification on pending items, de-duped, reset-on-empty | ✔ | `approvals.rs:245-321` |
| Notification click deep-links to web `/approvals` (and `/today`) | ✘ | `open_approvals_page` / `open_today_page` are **never called** — dead code; no notification click handler exists — see **D-2** |

---

## 6. Deviations

### Critical

- **D-1 — Auth transport mismatch (integration-breaking).** Tray sends Bearer tokens; backend routes are cookie-only and middleware redirects to `/signin`. Evidence and recommendation in §3. Blocks every runtime AC; must be resolved before the smoke-test gate can pass.
- **D-2 — Notification click → action path not wired (feature-completeness).** `dispatch_notification` fires a plain toast (`notify.rs:70-75`); no toast-click handler is registered anywhere (no Rust notification event listener; the `open_reminder_picker` command exists at `lib.rs:353-371` but nothing invokes it, and the encoded payload built by `notify::encode_action_payload` is never attached to a notification). Likewise briefing/approval toasts have no click handling, so the epic's "clicking it opens the web `/approvals` page" and the picker-window fallback documented in `notify.rs:4-23` are unreachable in practice. Per-reminder Snooze 15m/1h/Dismiss (epic success metric #1) is therefore only exercisable via manual command invocation. The module comments acknowledge WinRT toast-action unreliability on unsigned builds and chose the picker fallback — but the fallback's trigger was never connected. **Recommendation:** wire a click path (e.g., `on_notification` event if the plugin exposes it on Windows, or a tray-menu "Due reminders…" list that opens the picker per reminder as an interim), or explicitly descope click-to-act in the epic doc and rely on Snooze All + web app until packaging (Epic 8) enables real toast buttons.

### Warning

- **D-3 — 401 refresh loop is half-wired.** Rust emits `coriven://auth/refresh-needed` (`poll.rs:308,538`; `actions.rs:260-263`) and the design comment (`actions.rs:246-259`) says the webview listens, calls `refreshSession()`, and re-notifies Rust — but `dist/index.html` contains **no listener** for that event (only `onAuthStateChange`). Since the sign-in window is normally closed, and Supabase-js `autoRefreshToken` only runs while a webview with a session exists, an expired access token will strand the poll loop in offline/cached mode until the user manually opens the sign-in window. Add the event listener and/or keep a hidden webview alive for token rotation.
- **D-4 — Dismiss persistence bypasses the `DedupeCache` seam.** `handle_dismiss` re-implements the `notified-cache.json` read-modify-write inline (`actions.rs:188-212`, comment admits replication). Besides the duplication, there is a lost-update window: a poll cycle holds its own loaded copy of the cache (`poll.rs:328`) and persists after dismiss writes, silently dropping the dismissed key. Route dismiss through a shared `DedupeCache::insert` (behind the existing managed state) instead.
- **D-5 — Committed placeholder assets.** `src-tauri/icons/*` are generated placeholders (`gen_icons.py` committed alongside; `lib.rs:185` notes "replace with the final Coriven brand asset before release"). Acceptable for the unsigned validation phase — flagging so it is tracked into Epic 8. Hygiene is otherwise correct: `target/` gitignored (`apps/tray/.gitignore:2`), `dist/config.js` and `dist/vendor/` gitignored (`apps/tray/dist/.gitignore:14-18`), no secrets in VCS (anon key intentionally external via `config.js`).

### Info

- **I-1 — Notification seam not used uniformly.** Briefing and approvals call `tauri_plugin_notification` directly (`briefing.rs:251-258`, `approvals.rs:298-304`) instead of the `notify::dispatch_notification` seam Wave 6.2.1 handed off "for Feature 6.3 reuse." Cosmetic today; consolidate when D-2 is fixed so click routing lives in one place.
- **I-2 — Dead/unused code:** `open_today_page`, `open_approvals_page`, `today_page_url`, `approvals_page_url` (`briefing.rs:297-302`, `approvals.rs:325-348`) uncalled (consequence of D-2); `SNOOZE_15M` used only in tests (picker passes literal 15); `should_notify` (`poll.rs:107-109`) used only in tests while the loop checks `cache.contains` directly.
- **I-3 — `reqwest::Client::new()` per request** in all four fetch helpers; a shared client (connection pooling) is the idiomatic fix. No functional impact at a 5-minute cadence.
- **I-4 — Webview CSP** allows `script-src 'unsafe-inline'` (`tauri.conf.json:14`) — required by the single-file inline-script `index.html`; fine for this phase, revisit if the webview grows.
- **I-5 — Cross-language contract duplication is inherent and handled well:** Rust structs cite the exact web-route select shapes in comments (`poll.rs:39-48`), and the one TS-shared contract (`PendingApprovalsResponse`) is consumed from `@personal-assistant/types` by the web route. The tray (Rust) cannot import TS types; the comment-anchored mirroring plus wholesale-reject parsing is an acceptable pattern.
- **I-6 — Doc status lag:** epic and wave docs still say `status: Planning` and retrospectives are unfilled; update when the smoke test completes. ADR-014 remains accurate to what was built.

---

## 7. Monorepo / Structure Conformance — CONFORMANT

- `apps/tray` participates in the npm workspace via the existing `apps/*` glob; named `@personal-assistant/tray`; root scripts `tray:dev` / `tray:build` added (`package.json:15-16`).
- The tray does **not** import from `apps/web` internals — the Rust shell has no TS imports at all, and `dist/index.html` is self-contained (Supabase UMD vendored at build time by `apps/tray/scripts/bundle-deps.js`).
- Committed artifacts are appropriate: Rust `target/` and Tauri `gen/` ignored; `dist/index.html` deliberately force-tracked with rationale (`apps/tray/.gitignore:14-17`, root `.gitignore:16-21`); generated `config.js`/`vendor/` excluded. Placeholder icons flagged (D-5).

## 8. Cross-Wave Coherence — CONFORMANT

One poll loop (`run_poll_cycle`) drives all three channels with a single signed-in gate and token resolution; briefing/approvals reuse it via a consistent snapshot/write-back (lock-free-across-await) pattern (`poll.rs:403-494`). Auth state (`AuthState`), offline cache (`DueCache`), and the snooze queue are each defined once and shared across waves 6.2.1→6.3.2; offline behavior for the non-cacheable briefing/approval channels is a deliberate, documented skip (`poll.rs:386-400`). No per-wave reimplementations found except the dismiss write path (D-4) and the direct plugin calls (I-1). 60 unit tests across modules cover the pure decision logic specified in the wave test cases.

---

## 9. Verdict

| Question | Answer |
|---|---|
| Is the tray a thin shell? | **Yes — verified, no leaked business logic.** |
| Does it honor ADR-014's scope discipline? | **Yes — Mac/signing/CI/PKCE cleanly absent, keychain auth as specified.** |
| Will it work against the deployed API? | **No, not as committed — D-1 (Bearer vs cookie) must be fixed first.** |
| Are the epic's acceptance criteria all reachable? | **Mostly; per-reminder snooze/dismiss and deep-links need D-2.** |
| PR-ready? | **Not yet.** Fix D-1 (+ decide D-2's wiring or descope), address D-3, then run the pending manual Windows smoke test, which is the true gate this static review cannot replace. |

*This review is advisory. Findings are based on static inspection of the committed sources; no code was modified.*

---

## Remediation Addendum (2026-07-05)

The review's blocking findings were fixed in commits `27ca130` (D-1) and `47c34c3` (D-2/D-3/D-4 + hardening):

- **D-1 (Critical) — RESOLVED.** Bearer JWT auth added to the 4 tray-consumed routes via `createApiServerClient` (validated server-side, RLS applies); middleware no longer redirects Authorization-carrying `/api/*` to `/signin`. Recorded in ADR-015. 362 web tests pass.
- **D-2 (Critical) — RESOLVED (with a design consequence).** `tauri-plugin-notification` v2.3.3 has no toast-click callback on Windows desktop (confirmed in plugin source), so toast-click→picker is not achievable with this plugin. The action paths are now reachable via reliable **tray-menu triggers** ("Due reminders…" opens the picker; "Today's briefing"/"Pending approvals" open the deep-links). The tray menu — not toast activation — is the primary action trigger. No dead handlers remain.
- **D-3 (Warning) — RESOLVED.** Webview listener for `coriven://auth/refresh-needed` refreshes the Supabase session and re-notifies, recovering the poll loop after token expiry.
- **D-4 (Warning) — RESOLVED.** Dismiss and the poll cycle now share one `Arc<Mutex<DedupeCache>>`; no lost-update race, no lock held across await.
- **SEC-1 (Medium, security audit) — RESOLVED.** Inline scripts externalized to `dist/app.js`; `script-src 'unsafe-inline'` dropped.
- **SEC-2 (Low) — RESOLVED.** `@supabase/supabase-js` pinned to 2.108.2.

**Tracked (non-blocking, deferred):** D-5 placeholder icons → Epic 8; narrow `connect-src` to the exact Supabase project ref; validate `CORIVEN_WEB_URL` scheme; add `cargo audit`/`cargo deny` to CI; first-run autostart consent; (Epic 8) Mac build + code-signing + release CI + PKCE.

**Revised status: PR-ready pending the manual Windows smoke test** (which remains the true runtime gate this static + compile-verified review cannot replace).
