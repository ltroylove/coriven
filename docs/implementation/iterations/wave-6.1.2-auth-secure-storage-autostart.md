---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-04"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "6"
feature: "6.1"
wave: "6.1.2"
agents: [backend-specialist, frontend-specialist, security-auditor, quality-control]
tags: [coriven, tray, tauri, auth, supabase, secure-storage, keychain, autostart, windows]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 6.1.2: Supabase Auth, Secure Token Storage & Autostart

## Wave Overview
- **Wave ID:** Wave-6.1.2
- **Feature:** Feature 6.1 - Tauri Shell, Auth & Autostart
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: Supabase sign-in inside the tray's webview (same account and session pattern as `apps/web`); the refresh token persisted exclusively to OS-keychain-backed Tauri secure storage — never plaintext, never logged; silent session restore on startup; sign-out that wipes the stored credential; autostart on Windows login via the Tauri autostart plugin.
- **Wave Goal:** The tray authenticates as the Coriven user once, then survives restarts and machine logins on its own — an authenticated, always-on shell ready for the poll/notify waves (6.2/6.3).

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A user can sign in to their Coriven (Supabase) account from the tray app via a sign-in window, reusing the same auth backend as the web app.
2. After sign-in, the session survives app restarts: the refresh token persists in OS-keychain-backed secure storage and the app silently restores a valid session on startup, handling token rotation.
3. The refresh token — the wave's one sensitive asset — never touches a plaintext file, never appears in any log or error output, and is removed on sign-out (ADR-014 mitigation, epic security section).
4. The app starts automatically on Windows login as a tray icon, and autostart can be turned off.
5. Expired or revoked sessions degrade gracefully to a re-sign-in prompt rather than silent failure.

## User Stories

### User Story 1: Sign in from the tray

**As a** Coriven user
**I want** to sign in to my Coriven account from the tray app
**So that** the tray can act as me against the backend without a browser open

**Acceptance Criteria:**
- [ ] When no session exists, choosing to open the app (or first launch) presents a sign-in window accepting my existing Coriven credentials.
- [ ] Successful sign-in uses the same Supabase account as the web app — no separate registration.
- [ ] After sign-in the window closes and the app returns to tray-only operation.
- [ ] Failed sign-in shows a clear error and lets me retry; no credential is stored on failure.

**Priority:** High

---

### User Story 2: Session survives restarts

**As a** Coriven user
**I want** the tray to stay signed in across app restarts and reboots
**So that** desktop delivery works unattended without daily re-login

**Acceptance Criteria:**
- [ ] After signing in once, quitting and relaunching the app restores a working session with no user interaction.
- [ ] Session restore obtains a fresh access token via the stored refresh token, and any rotated refresh token replaces the stored one.
- [ ] If the stored token is expired or revoked, the app prompts for sign-in instead of failing silently or crashing.

**Priority:** High

---

### User Story 3: Credential kept in secure storage only

**As the** owner/security reviewer
**I want** the persisted refresh token confined to OS-keychain-backed secure storage
**So that** the tray's one credential-at-rest is protected and never leaks via files or logs

**Acceptance Criteria:**
- [ ] The refresh token is stored only via the OS credential store (Windows Credential Manager on Windows); no plaintext file, app config, or local-storage copy exists.
- [ ] No token value ever appears in logs, error messages, or crash output — verified by inspection under both success and failure paths.
- [ ] Signing out deletes the stored token; the next launch requires sign-in.
- [ ] The in-memory access token is never persisted anywhere.

**Priority:** High

---

### User Story 4: Starts on login

**As a** Coriven user
**I want** the tray app to start automatically when I log in to Windows
**So that** reminders and alerts fire without me remembering to launch anything

**Acceptance Criteria:**
- [ ] After enabling autostart, logging in to Windows brings up the tray icon without user action.
- [ ] Autostart launches into tray-only mode (no window), silently restoring the session per User Story 2.
- [ ] Autostart can be disabled by the user and the setting persists.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Sign-in establishes a session
- **Endpoint:** Supabase auth (password grant, same project as `apps/web`)
- **Method:** POST (via Supabase client in the webview)
- **Test Data:** Valid Coriven dev-account credentials
- **Expected Result:** Session established; refresh token written to the OS credential store
- **Verification:** An authenticated call to an existing API route (e.g. the due-tasks endpoint) returns 200 as that user

### Test Case 2: Silent restore on restart
- **Endpoint:** Supabase auth (token refresh)
- **Method:** POST (on startup, using the stored refresh token)
- **Test Data:** App restart after a prior successful sign-in
- **Expected Result:** Fresh access token obtained with no UI; rotated refresh token re-persisted
- **Verification:** No sign-in window appears; an authenticated API call succeeds; credential-store entry updated

### Test Case 3: Revoked/expired token degrades to sign-in
- **Endpoint:** Supabase auth (token refresh)
- **Method:** POST with an invalidated refresh token
- **Test Data:** Token revoked server-side (or corrupted stored value)
- **Expected Result:** Refresh fails; app prompts for sign-in; stale credential cleared
- **Verification:** No crash, no retry loop; error output contains no token value

### Test Case 4: Sign-out wipes the credential
- **Endpoint:** Internal — sign-out action + credential store
- **Method:** Action + inspection
- **Test Data:** Signed-in app
- **Expected Result:** Credential-store entry removed; next launch requires sign-in
- **Verification:** Windows Credential Manager shows no Coriven entry after sign-out

### Test Case 5: Autostart on login
- **Endpoint:** Internal — OS login
- **Method:** Enable autostart, log out/in (or reboot)
- **Test Data:** Autostart enabled, valid stored session
- **Expected Result:** Tray icon appears after login; session restored silently
- **Verification:** Icon present without manual launch; disabling autostart stops this behavior

## Technical Tasks

### Task 1: Secure-storage bridge for the refresh token
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours (uncertainty: Tauri v2 has no first-party OS-keychain plugin — see Notes)
- **Dependencies:** Wave 6.1.1 complete
- **Priority:** High

**Deliverables:**
- Rust-side store/retrieve/delete capability for a single named credential, backed by the OS credential store (Windows Credential Manager; keychain-equivalent on other platforms), exposed to the webview via Tauri commands
- Unit tests for store/retrieve/delete and the missing-credential path
- Logging that records outcomes only — never credential values

**Acceptance Criteria:**
- [ ] Credential round-trips through the OS credential store; nothing is written to disk in plaintext
- [ ] Deleting is idempotent; retrieving a missing credential yields a typed "absent" result, not an error crash
- [ ] Code review confirms no code path can log or serialize the credential value

---

### Task 2: Sign-in window with Supabase auth
- **Agent:** frontend-specialist
- **Estimation:** 5-8 hours
- **Dependencies:** Wave 6.1.1 complete (parallel with Task 1)
- **Priority:** High

**Deliverables:**
- On-demand sign-in window in the tray's webview using the Supabase client against the same project/auth pattern as `apps/web`
- Sign-in, error, and retry states; window closes back to tray-only on success
- Session state surfaced to the shell (signed-in / signed-out) so menu behavior can reflect it

**Acceptance Criteria:**
- [ ] Behaves per User Story 1 acceptance criteria
- [ ] Client-side session persistence is delegated to the secure-storage bridge — the default browser-storage persistence is disabled
- [ ] No Supabase service credentials involved; only the public URL + anon key are embedded (they are public by design)

---

### Task 3: Startup session restore, token rotation, and sign-out
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours
- **Dependencies:** Task 1, Task 2
- **Priority:** High

**Deliverables:**
- Startup flow: read stored refresh token → obtain fresh session → re-persist rotated refresh token; on failure, clear stale credential and route to sign-in
- Sign-out action (from the auth window or tray) that ends the session and deletes the stored credential
- Access token held in memory only, available to the shell for authenticated API calls (consumed by Feature 6.2)

**Acceptance Criteria:**
- [ ] Behaves per User Stories 2 and 3 acceptance criteria (Test Cases 2-4)
- [ ] Refresh handles Supabase refresh-token rotation correctly (a reused-stale-token failure is treated as revoked)
- [ ] Offline at startup: restore is retried when connectivity returns rather than discarding the credential

---

### Task 4: Autostart on login
- **Agent:** backend-specialist
- **Estimation:** 2-4 hours
- **Dependencies:** Wave 6.1.1 complete (parallel with Tasks 1-3)
- **Priority:** Medium

**Deliverables:**
- Tauri autostart plugin integrated; autostart enabled by default on first successful sign-in, with a user-visible way to disable it
- Autostart launches tray-only and triggers the silent restore path

**Acceptance Criteria:**
- [ ] Behaves per User Story 4 acceptance criteria (Test Case 5)
- [ ] Uses the cross-platform autostart plugin — no hand-rolled Windows registry code (blueprint §13.3)

---

### Task 5: Security review of credential handling
- **Agent:** security-auditor
- **Estimation:** 2-3 hours
- **Dependencies:** Task 3, Task 4
- **Priority:** High

**Deliverables:**
- Audit of all token paths: storage location, log/error output under success and failure, sign-out wipe, memory-only access token
- Findings recorded; any violation remediated before wave close

**Acceptance Criteria:**
- [ ] No token value reachable in any file, log, or error path
- [ ] Storage confirmed OS-keychain-backed; no fallback silently downgrades to plaintext
- [ ] Thin-shell re-check: this wave added auth only — still no DB access or business logic in the tray

## Task Dependencies

```
Wave 6.1.1 (shell)
  ├─> Task 1 (secure-storage bridge)   ─┐
  ├─> Task 2 (sign-in window)          ─┤
  │                                     ▼
  │                          Task 3 (restore + rotation + sign-out)
  └─> Task 4 (autostart)                │
              └───────────────┬─────────┘
                              ▼
                    Task 5 (security review)
```

**Critical path:** Task 1/Task 2 → Task 3 → Task 5.
**Parallel streams:** Tasks 1, 2, and 4 are independent and can proceed concurrently once 6.1.1 lands.
**Bottleneck:** Task 1 — the secure-storage approach must be validated early (no first-party Tauri v2 keychain plugin; see Notes); it gates Task 3 and the wave's security posture.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 3, Task 4 | 10-16 |
| frontend-specialist | Task 2 | 5-8 |
| security-auditor | Task 5 | 2-3 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing (secure-storage bridge; restore/rotation paths)
- [ ] Test cases 1-5 verified and recorded (Test Case 1 against a dev account)
- [ ] Security review passed: token OS-keychain-only, never logged, wiped on sign-out
- [ ] Thin-shell checklist re-passed (no DB access or business logic added)
- [ ] Repo-wide typecheck passes; no linter errors
- [ ] Code reviewed and approved
- [ ] Documentation updated (auth flow, autostart behavior, secure-storage approach and its rationale)

## Infrastructure Specifications

### Auth

- **Identity:** The same Supabase project and user accounts as `apps/web`; email/password sign-in via the Supabase JS client running in the tray webview. PKCE OAuth (localhost callback) is explicitly deferred to Epic 8 (blueprint §13.3, epic out-of-scope).
- **Session model:** Access token in memory only; refresh token persisted solely through the secure-storage bridge. The Supabase client's default persistence is replaced with a custom storage adapter that delegates to the bridge (only the refresh credential is durable).
- **Rotation:** Supabase rotates refresh tokens on use; every successful refresh re-persists the new token atomically. A refresh rejection is treated as revocation → clear credential → sign-in prompt.

### Secure Storage (assumption — validate in Task 1)

- **Approach:** Tauri v2 ships no first-party OS-keychain plugin. Plan of record: the Rust `keyring` crate (Windows Credential Manager on Windows; macOS Keychain / Secret Service elsewhere — keeps the source cross-platform) wrapped in app-defined Tauri commands, with capability permissions restricting access to the app's own webview.
- **Fallbacks (in order):** a maintained community keyring/keychain Tauri plugin if one proves more robust; `tauri-plugin-stronghold` only as last resort (encrypted file, not OS-keychain — weaker fit for the "OS-keychain-backed" requirement and needs its own key-handling story; using it requires revisiting this wave's security section).
- **Forbidden:** plaintext files, Tauri store plugin (unencrypted JSON), webview localStorage, environment variables, or logs for the token.

### Plugins & Configuration

| Item | Choice | Notes |
|---|---|---|
| Autostart | `tauri-plugin-autostart` (official Tauri v2 plugin) | Cross-platform; replaces any registry hand-rolling |
| Secure storage | Rust `keyring` crate via Tauri commands (assumption above) | Windows Credential Manager backend on Windows |
| Supabase client | `@supabase/supabase-js` in the webview | Same version family as `apps/web`; custom storage adapter |
| Config values | Supabase URL + anon key, web app URL | Anon key is public by design; no server-side secrets ship in the tray |

### Testing

- Unit: secure-storage bridge (store/retrieve/delete/absent), restore flow (valid / rotated / revoked / offline).
- Integration: Test Cases 1-5 against the real Supabase project with a dev account — no mocking for the credential-store and refresh-rotation assertions.
- Negative: log/error inspection under forced failures to assert no token leakage.

### Monitoring

- Structured logs for auth lifecycle events (signed in, restored, refresh failed, signed out) with outcome and error class only — never token values or credentials.

## Handoff Requirements

**For Feature 6.2 (next waves):**
- An authenticated shell: a stable way for the poll loop to make API calls as the signed-in user (in-memory access token + transparent refresh). Its shape must be settled before poll-loop work starts.
- Signed-out and offline states defined, so the poll loop knows when to pause rather than fail.

**For Feature 6.3 / Epic 7:**
- The same authenticated-call and session-lifecycle guarantees (briefing/approval polls and Epic 7 nudge delivery reuse them unchanged).

**For Epic 8 (deferred scope):**
- Documented secure-storage decision and auth flow as the baseline the PKCE migration and signed-build work will replace/harden.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| No first-party Tauri v2 keychain plugin; chosen crate/plugin behaves unexpectedly on Windows | High | Task 1 validates the approach first with a spike + unit tests before Task 3 builds on it; fallback order documented |
| Refresh-token rotation race (crash between refresh and re-persist) strands the session | Med | Persist-then-confirm ordering; a failed restore falls back to sign-in prompt, never a crash loop |
| Token leaks via logs/errors (the epic's highest-severity security risk) | High | Never-log rule enforced in code review + dedicated security review (Task 5) with forced-failure inspection |
| Supabase client assumes browser storage semantics in the webview | Med | Custom storage adapter is scoped in Task 2; verified by Test Case 2 before the wave closes |
| Autostart fires before network is up, failing restore | Low | Restore retries on connectivity (Task 3); offline behavior is an explicit acceptance criterion |

## Notes and Assumptions

- **Assumption:** Tauri v2 with the official `tauri-plugin-autostart`. For secure storage, the Rust `keyring` crate via app Tauri commands is the plan of record because Tauri v2 lacks a first-party OS-keychain plugin; Task 1 validates this and the fallback order is specified in Infrastructure Specifications.
- Email/password sign-in only this epic; PKCE OAuth, Mac keychain verification, and signed builds are Epic 8 (ADR-014).
- Autostart defaults to enabled after first sign-in because an always-on tray is the epic's purpose; the user can disable it.
- No poll loop, notifications, or new backend endpoints in this wave — Features 6.2/6.3 own those. This wave's only backend interaction is Supabase auth plus one existing API call used as a session verification probe.
- Effort figures are scope-based solo-developer estimates; Task 1 carries the flagged uncertainty.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.1)
- Architecture Decision: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md (plus ADR-003, ADR-012)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§13.3)

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
