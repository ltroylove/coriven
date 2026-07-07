// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This module polls the daily briefing endpoint and fires a native notification
// exactly once per briefing. It contains:
//   - NO database client
//   - NO briefing assembly or content logic
//   - NO business rules — only the delivered flag from the server determines
//     whether to notify. The server is the sole source of truth.
//
// The delivered flag round-trip:
//   1. GET /api/briefing/today  (no special header)  → check was_delivered
//   2. If was_delivered == false: fire notification, then immediately re-GET
//      with  X-Mark-Delivered: true  header to atomically mark it delivered.
//   3. A per-session in-memory guard prevents a second notification even if
//      the mark-delivered call fails (offline mid-cycle) — the guard is reset
//      each time the tray starts, but the server flag persists across restarts.
//
// Deep link: clicking the toast opens the web /today page in the default browser.

use std::collections::HashSet;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// No crate imports needed at module level for poll-path functions;
// the notification plugin is accessed via tauri_plugin_notification::NotificationExt
// imported below. auth checks happen in poll.rs before calling into this module.

// ---------------------------------------------------------------------------
// API response shape — briefing summary (no content rendered by tray)
// ---------------------------------------------------------------------------

/// Minimal view of the briefing row the tray cares about.
///
/// The full row contains `content` (a complex JSON object with the actual
/// briefing text). The tray MUST NOT render that content — it only reads
/// `was_delivered` to decide whether to notify and `briefing_date` for logging.
/// The `content` field is accepted (and ignored) so the parser doesn't reject
/// valid server responses that include it.
#[derive(Debug, Clone, Deserialize)]
pub struct BriefingRow {
    /// Unique row id — used for logging only.
    pub id: String,
    /// The local date this briefing covers (YYYY-MM-DD).
    pub briefing_date: String,
    /// True once ANY surface has marked this briefing delivered.
    /// This is the server-side source of truth for exactly-once delivery.
    pub was_delivered: bool,
    // `content`, `delivered_at`, etc. are present in the actual response but
    // we intentionally omit them here — serde's default deny-unknown-fields
    // is NOT set, so extra fields are silently ignored.
}

/// The wrapper shape: `GET /api/briefing/today` returns `{ briefing: … | null }`.
#[derive(Debug, Deserialize)]
pub struct BriefingResponse {
    /// `None` when no briefing exists for today (server returns `{ briefing: null }`).
    pub briefing: Option<BriefingRow>,
}

// ---------------------------------------------------------------------------
// Per-session delivered guard
// ---------------------------------------------------------------------------

/// In-memory set of briefing ids for which a notification has already been fired
/// this session. Cleared on tray restart (the server's `was_delivered` flag covers
/// cross-session dedup; this is only for the within-session offline edge case).
///
/// Key = briefing row `id`. Not persisted — intentionally thin.
pub struct BriefingSessionGuard {
    /// Ids of briefings notified this session. `pub` so `poll.rs` can snapshot/writeback
    /// without holding a Mutex across an await boundary (lock-free-across-await pattern).
    pub notified_ids: HashSet<String>,
}

impl BriefingSessionGuard {
    pub fn new() -> Self {
        BriefingSessionGuard {
            notified_ids: HashSet::new(),
        }
    }

    /// Returns true if we have already notified for this briefing this session.
    pub fn already_notified(&self, briefing_id: &str) -> bool {
        self.notified_ids.contains(briefing_id)
    }

    /// Mark this briefing id as notified for this session.
    pub fn mark_notified(&mut self, briefing_id: String) {
        self.notified_ids.insert(briefing_id);
    }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/// Fetch today's briefing row from the server.
///
/// If `mark_delivered` is true, the request includes `X-Mark-Delivered: true`
/// so the server atomically marks the row delivered and returns the updated row.
///
/// Returns:
/// - `Ok(Some(row))` — briefing exists
/// - `Ok(None)`       — no briefing today (404 / `{ briefing: null }`)
/// - `Err(...)`       — network / auth / server error
pub async fn fetch_briefing(
    api_base_url: &str,
    access_token: &str,
    mark_delivered: bool,
) -> Result<Option<BriefingRow>, BriefingFetchError> {
    let url = format!("{}/api/briefing/today", api_base_url);
    let client = reqwest::Client::new();

    let mut req = client
        .get(&url)
        // SECURITY: Bearer token in header only — never logged, never in URL.
        .header("Authorization", format!("Bearer {access_token}"));

    if mark_delivered {
        req = req.header("X-Mark-Delivered", "true");
    }

    let response = req
        .send()
        .await
        .map_err(|e| BriefingFetchError::Network(e.to_string()))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BriefingFetchError::Unauthorized);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        // No briefing today — normal; silence is correct.
        return Ok(None);
    }
    if !status.is_success() {
        return Err(BriefingFetchError::HttpError(status.as_u16()));
    }

    // Parse the outer envelope.
    let envelope: BriefingResponse = response
        .json()
        .await
        .map_err(|e| BriefingFetchError::ParseError(e.to_string()))?;

    // Unwrap the nullable inner briefing.
    Ok(envelope.briefing)
}

/// Error type for the briefing fetch. Intentionally coarse.
#[derive(Debug)]
pub enum BriefingFetchError {
    Network(String),
    Unauthorized,
    HttpError(u16),
    ParseError(String),
}

impl std::fmt::Display for BriefingFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BriefingFetchError::Network(e) => write!(f, "network: {e}"),
            BriefingFetchError::Unauthorized => write!(f, "unauthorized (401)"),
            BriefingFetchError::HttpError(c) => write!(f, "http {c}"),
            BriefingFetchError::ParseError(e) => write!(f, "parse error: {e}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Poll action: decide + notify + mark
// ---------------------------------------------------------------------------

/// Run one briefing poll action.
///
/// Called each poll cycle from `poll::run_poll_cycle`. The caller has already
/// verified the signed-in gate; `token` and `api_base_url` are extracted there.
///
/// Behavior:
/// 1. Fetch today's briefing (no mark-delivered header on first probe).
/// 2. If none → log and return (silence is correct).
/// 3. If `was_delivered` is true → log and return (server says done).
/// 4. If already notified this session (guard) → log and return.
/// 5. Fire the notification.
/// 6. Mark the guard (prevents double-fire even if step 7 fails offline).
/// 7. Re-fetch with `X-Mark-Delivered: true` to persist delivery server-side.
///    Failure here is logged and tolerated — the guard covers this session;
///    the server flag may still be false and will be set on the next reconnect.
/// 8. Open the today page deep-link is handled by notification click (the toast
///    is informational; the `open_today` function is called from the tray event).
///
/// The `app` is used only for notification dispatch and browser open — no DB.
pub async fn run_briefing_poll(
    app: &AppHandle,
    session_guard: &mut BriefingSessionGuard,
    token: &str,
    api_base_url: &str,
) {
    eprintln!("[coriven-tray] briefing: polling /api/briefing/today");

    // Step 1: probe (no mark-delivered).
    let row = match fetch_briefing(api_base_url, token, false).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            eprintln!("[coriven-tray] briefing: no briefing today — nothing to notify");
            return;
        }
        Err(BriefingFetchError::Unauthorized) => {
            // Caller already handles the 401 event for the main reminder poll;
            // we log here so the log is complete but do not re-emit the event
            // (the poll loop will emit it once).
            eprintln!("[coriven-tray] briefing: 401 on probe — skipping cycle");
            return;
        }
        Err(e) => {
            eprintln!("[coriven-tray] briefing: probe failed ({e}) — skipping cycle");
            return;
        }
    };

    eprintln!(
        "[coriven-tray] briefing: found briefing id={} date={} was_delivered={}",
        row.id, row.briefing_date, row.was_delivered
    );

    // Step 3: server says already delivered.
    if row.was_delivered {
        eprintln!("[coriven-tray] briefing: already delivered (server flag) — silent");
        return;
    }

    // Step 4: session guard (offline protection for mark-delivered failure).
    if session_guard.already_notified(&row.id) {
        eprintln!(
            "[coriven-tray] briefing: already notified this session id={} — silent",
            row.id
        );
        return;
    }

    // Step 5: fire the notification.
    // Title is generic — no briefing content goes into the toast (thin-shell rule).
    let title = "Your daily briefing is ready";
    let body = format!("Tap to read your briefing for {}", row.briefing_date);

    // We pass a dummy NotificationMeta with empty fields — briefing notifications
    // don't need the reminder-action routing that NotificationMeta supports.
    // We call the notification plugin directly here to keep the meta orthogonal.
    use tauri_plugin_notification::NotificationExt;
    match app
        .notification()
        .builder()
        .title(title)
        .body(&body)
        .show()
    {
        Ok(()) => {
            eprintln!(
                "[coriven-tray] briefing: notification fired for id={}",
                row.id
            );
        }
        Err(e) => {
            eprintln!("[coriven-tray] briefing: notification dispatch failed: {e}");
            // Do NOT mark guard or call mark-delivered — we didn't actually notify.
            return;
        }
    }

    // Step 6: mark the session guard immediately after firing.
    session_guard.mark_notified(row.id.clone());

    // Step 7: mark delivered server-side. Failure is tolerated (offline resilience).
    match fetch_briefing(api_base_url, token, true).await {
        Ok(_) => {
            eprintln!(
                "[coriven-tray] briefing: server-side delivered flag set for id={}",
                row.id
            );
        }
        Err(e) => {
            eprintln!(
                "[coriven-tray] briefing: mark-delivered failed ({e}) — session guard active; will retry on reconnect"
            );
            // The session guard prevents double-fire this session.
            // On next tray start, the server flag will still be false, and the
            // user may receive a second notification on a fresh session — which is
            // acceptable per the wave spec's offline tolerance clause.
        }
    }
}

/// Open the Coriven web app's /today page in the default browser.
/// Called when the user clicks the briefing notification (or from future deep-link hooks).
pub fn open_today_page(app: &AppHandle, web_app_url: &str) {
    let url = format!("{}/today", web_app_url);
    if let Err(e) = app.opener().open_url(&url, None::<&str>) {
        eprintln!("[coriven-tray] briefing: failed to open today page at {url}: {e}");
    }
}

// ---------------------------------------------------------------------------
// Deliver-once decision (pure — testable without Tauri)
// ---------------------------------------------------------------------------

/// Decide whether a briefing notification should fire, given the server row and
/// the session guard state.
///
/// Pure function — no I/O, no Tauri. Used directly in unit tests.
///
/// Returns `true` iff:
/// - `row.was_delivered == false`  AND
/// - `already_notified == false`
pub fn should_notify_briefing(was_delivered: bool, already_notified: bool) -> bool {
    !was_delivered && !already_notified
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------------
    // BriefingRow deserialization
    // ---------------------------------------------------------------------------

    #[test]
    fn briefing_row_deserialises_undelivered() {
        let json = r#"{
            "id": "brf-001",
            "briefing_date": "2026-07-04",
            "was_delivered": false,
            "content": {"summary": "some content"},
            "delivered_at": null
        }"#;
        let row: BriefingRow = serde_json::from_str(json).unwrap();
        assert_eq!(row.id, "brf-001");
        assert_eq!(row.briefing_date, "2026-07-04");
        assert!(!row.was_delivered);
    }

    #[test]
    fn briefing_row_deserialises_delivered() {
        let json = r#"{
            "id": "brf-002",
            "briefing_date": "2026-07-04",
            "was_delivered": true,
            "delivered_at": "2026-07-04T09:05:00Z"
        }"#;
        let row: BriefingRow = serde_json::from_str(json).unwrap();
        assert!(row.was_delivered);
    }

    #[test]
    fn briefing_response_deserialises_null_briefing() {
        let json = r#"{"briefing": null}"#;
        let resp: BriefingResponse = serde_json::from_str(json).unwrap();
        assert!(resp.briefing.is_none());
    }

    #[test]
    fn briefing_response_deserialises_present_briefing() {
        let json = r#"{
            "briefing": {
                "id": "brf-003",
                "briefing_date": "2026-07-04",
                "was_delivered": false
            }
        }"#;
        let resp: BriefingResponse = serde_json::from_str(json).unwrap();
        assert!(resp.briefing.is_some());
        assert_eq!(resp.briefing.unwrap().id, "brf-003");
    }

    // ---------------------------------------------------------------------------
    // should_notify_briefing — deliver-once decision
    // ---------------------------------------------------------------------------

    #[test]
    fn should_notify_when_not_delivered_and_not_guarded() {
        assert!(should_notify_briefing(false, false));
    }

    #[test]
    fn should_not_notify_when_server_says_delivered() {
        assert!(!should_notify_briefing(true, false));
    }

    #[test]
    fn should_not_notify_when_session_guard_active() {
        assert!(!should_notify_briefing(false, true));
    }

    #[test]
    fn should_not_notify_when_both_delivered_and_guarded() {
        assert!(!should_notify_briefing(true, true));
    }

    // ---------------------------------------------------------------------------
    // BriefingSessionGuard
    // ---------------------------------------------------------------------------

    #[test]
    fn session_guard_starts_empty() {
        let guard = BriefingSessionGuard::new();
        assert!(!guard.already_notified("brf-001"));
    }

    #[test]
    fn session_guard_marks_and_recalls() {
        let mut guard = BriefingSessionGuard::new();
        guard.mark_notified("brf-001".to_string());
        assert!(guard.already_notified("brf-001"));
    }

    #[test]
    fn session_guard_does_not_affect_other_ids() {
        let mut guard = BriefingSessionGuard::new();
        guard.mark_notified("brf-001".to_string());
        assert!(!guard.already_notified("brf-002"));
    }

    #[test]
    fn session_guard_mark_is_idempotent() {
        let mut guard = BriefingSessionGuard::new();
        guard.mark_notified("brf-001".to_string());
        guard.mark_notified("brf-001".to_string());
        assert!(guard.already_notified("brf-001"));
        assert_eq!(guard.notified_ids.len(), 1);
    }

    // ---------------------------------------------------------------------------
    // Deliver-once combined scenarios (Test Case 1 and 2 from the wave spec)
    // ---------------------------------------------------------------------------

    /// Test Case 1: Undelivered briefing notifies once.
    #[test]
    fn undelivered_briefing_fires_exactly_once() {
        let mut guard = BriefingSessionGuard::new();
        let briefing_id = "brf-tc1".to_string();

        // First poll: server says not delivered, guard empty → should notify.
        let fire_1 = should_notify_briefing(false, guard.already_notified(&briefing_id));
        assert!(fire_1, "first poll should notify");

        // Simulate notification fired — mark guard.
        guard.mark_notified(briefing_id.clone());

        // Second poll (same session): guard active → should NOT notify.
        let fire_2 = should_notify_briefing(false, guard.already_notified(&briefing_id));
        assert!(!fire_2, "second poll same session should be silent");
    }

    /// Test Case 2a: Briefing with was_delivered == true → silent.
    #[test]
    fn delivered_briefing_is_silent() {
        let guard = BriefingSessionGuard::new();
        let briefing_id = "brf-tc2a";
        // Server already marked delivered (e.g. web app delivered it).
        let fire = should_notify_briefing(true, guard.already_notified(briefing_id));
        assert!(!fire, "delivered briefing must be silent");
    }

    /// Test Case 2b: Guard active from this session; server flag still false
    /// (mark-delivered failed offline) → session guard keeps it silent.
    #[test]
    fn session_guard_suppresses_even_when_server_flag_false() {
        let mut guard = BriefingSessionGuard::new();
        let briefing_id = "brf-tc2b".to_string();
        guard.mark_notified(briefing_id.clone());

        // Server flag is still false (offline mark-delivered failed).
        let fire = should_notify_briefing(false, guard.already_notified(&briefing_id));
        assert!(!fire, "session guard must suppress even with server flag false");
    }

    // ---------------------------------------------------------------------------
    // BriefingFetchError display (no sensitive content)
    // ---------------------------------------------------------------------------

    #[test]
    fn fetch_error_display_has_no_secret_values() {
        let cases = [
            BriefingFetchError::Network("connection refused".to_string()),
            BriefingFetchError::Unauthorized,
            BriefingFetchError::HttpError(500),
            BriefingFetchError::ParseError("unexpected field".to_string()),
        ];
        for e in &cases {
            let s = e.to_string();
            // Must never contain a token or auth secret (the error string is logged).
            assert!(!s.contains("Bearer"));
            assert!(!s.contains("token"));
        }
    }
}
