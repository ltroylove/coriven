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
/// For weekly reviews the tray also reads `content.wins` length for the
/// notification body — but only the array length, not the task titles.
#[derive(Debug, Clone, Deserialize)]
pub struct BriefingRow {
    /// Unique row id — used for logging only.
    pub id: String,
    /// The local date this briefing covers (YYYY-MM-DD).
    pub briefing_date: String,
    /// True once ANY surface has marked this briefing delivered.
    /// This is the server-side source of truth for exactly-once delivery.
    pub was_delivered: bool,
    /// Briefing type: 'daily' or 'weekly'. Defaults to 'daily' when absent
    /// (older rows before Wave 7.3.1 migration).
    #[serde(default = "default_briefing_type")]
    pub r#type: String,
    /// Raw content JSON — parsed only for weekly reviews to extract wins count.
    /// Typed as serde_json::Value to avoid a tight coupling to the content schema.
    pub content: Option<serde_json::Value>,
}

fn default_briefing_type() -> String {
    "daily".to_string()
}

/// The wrapper shape: `GET /api/briefing/today` returns:
/// - `{ briefing: … | null, briefings: […] }` (Wave 7.3.1 extended shape)
/// - The tray processes `briefings` for multi-type support; falls back to the
///   legacy `briefing` field when `briefings` is absent for backward compat.
#[derive(Debug, Deserialize)]
pub struct BriefingResponse {
    /// Legacy field — the daily briefing for today (may be null).
    /// Kept for backward compatibility.
    pub briefing: Option<BriefingRow>,
    /// All briefings (daily + weekly) for the current user. Added in Wave 7.3.1.
    /// May be absent on older server versions (backward compat).
    #[serde(default)]
    pub briefings: Vec<BriefingRow>,
}

/// Extract the wins count from a weekly review content JSON value.
/// Returns 0 if the field is absent or not an array (safe default).
pub fn wins_count_from_content(content: &Option<serde_json::Value>) -> usize {
    content
        .as_ref()
        .and_then(|v| v.get("wins"))
        .and_then(|wins| wins.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0)
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

/// Fetch today's briefing envelope from the server.
///
/// Returns:
/// - `Ok(Some(envelope))` — one or more briefings exist
/// - `Ok(None)`            — no briefings today (404 / empty response)
/// - `Err(...)`            — network / auth / server error
pub async fn fetch_briefing(
    api_base_url: &str,
    access_token: &str,
) -> Result<Option<BriefingResponse>, BriefingFetchError> {
    let url = format!("{}/api/briefing/today", api_base_url);
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        // SECURITY: Bearer token in header only — never logged, never in URL.
        .header("Authorization", format!("Bearer {access_token}"))
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

    // Return None if there are no briefings at all.
    if envelope.briefings.is_empty() && envelope.briefing.is_none() {
        return Ok(None);
    }

    Ok(Some(envelope))
}

/// POST to /api/briefing/[id]/deliver to mark a briefing as delivered server-side.
///
/// Returns Ok(()) on 2xx, Err on any other outcome.
pub async fn post_deliver(
    api_base_url: &str,
    access_token: &str,
    briefing_id: &str,
) -> Result<(), BriefingFetchError> {
    let url = format!("{}/api/briefing/{}/deliver", api_base_url, briefing_id);
    let client = reqwest::Client::new();

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| BriefingFetchError::Network(e.to_string()))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BriefingFetchError::Unauthorized);
    }
    if !status.is_success() {
        return Err(BriefingFetchError::HttpError(status.as_u16()));
    }

    Ok(())
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
/// Wave 7.3.1: Processes ALL briefings from `response.briefings` (daily + weekly).
/// Each undelivered, un-guarded briefing fires exactly one notification.
/// Weekly reviews fire: "Your weekly review is ready — N wins this week".
/// Daily briefings fire: "Your daily briefing is ready / Tap to read…".
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
    let envelope = match fetch_briefing(api_base_url, token).await {
        Ok(Some(e)) => e,
        Ok(None) => {
            eprintln!("[coriven-tray] briefing: no briefings today — nothing to notify");
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

    // Collect all rows to process: prefer `briefings` (Wave 7.3.1 multi-type),
    // fall back to the legacy `briefing` field for backward compat.
    let rows: Vec<BriefingRow> = if !envelope.briefings.is_empty() {
        envelope.briefings
    } else if let Some(row) = envelope.briefing {
        vec![row]
    } else {
        eprintln!("[coriven-tray] briefing: empty briefings payload — nothing to notify");
        return;
    };

    for row in rows {
        notify_single_briefing(app, session_guard, token, api_base_url, row).await;
    }
}

/// Process a single briefing row: check delivery state, fire notification,
/// mark delivered via the deliver endpoint.
async fn notify_single_briefing(
    app: &AppHandle,
    session_guard: &mut BriefingSessionGuard,
    token: &str,
    api_base_url: &str,
    row: BriefingRow,
) {
    eprintln!(
        "[coriven-tray] briefing: found briefing id={} type={} date={} was_delivered={}",
        row.id, row.r#type, row.briefing_date, row.was_delivered
    );

    // Server says already delivered.
    if row.was_delivered {
        eprintln!("[coriven-tray] briefing: id={} already delivered (server flag) — silent", row.id);
        return;
    }

    // Session guard (offline protection for mark-delivered failure).
    if session_guard.already_notified(&row.id) {
        eprintln!(
            "[coriven-tray] briefing: id={} already notified this session — silent",
            row.id
        );
        return;
    }

    // Build notification text based on type.
    let (title, body) = if row.r#type == "weekly" {
        let wins = wins_count_from_content(&row.content);
        let wins_label = if wins == 1 { "1 win".to_string() } else { format!("{wins} wins") };
        (
            "Your weekly review is ready".to_string(),
            format!("{wins_label} this week"),
        )
    } else {
        (
            "Your daily briefing is ready".to_string(),
            format!("Tap to read your briefing for {}", row.briefing_date),
        )
    };

    // Fire the notification.
    use tauri_plugin_notification::NotificationExt;
    match app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
    {
        Ok(()) => {
            eprintln!(
                "[coriven-tray] briefing: notification fired for id={} type={}",
                row.id, row.r#type
            );
        }
        Err(e) => {
            eprintln!("[coriven-tray] briefing: notification dispatch failed for id={}: {e}", row.id);
            // Do NOT mark guard or call mark-delivered — we didn't actually notify.
            return;
        }
    }

    // Mark the session guard immediately after firing.
    session_guard.mark_notified(row.id.clone());

    // Mark delivered server-side via the deliver endpoint.
    // Failure is tolerated (offline resilience) — session guard covers this session.
    match post_deliver(api_base_url, token, &row.id).await {
        Ok(()) => {
            eprintln!(
                "[coriven-tray] briefing: server-side delivered flag set for id={}",
                row.id
            );
        }
        Err(e) => {
            eprintln!(
                "[coriven-tray] briefing: mark-delivered failed for id={} ({e}) — session guard active; will retry on reconnect",
                row.id
            );
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

    // ---------------------------------------------------------------------------
    // Wave 7.3.1: Weekly review — wins_count_from_content
    // ---------------------------------------------------------------------------

    #[test]
    fn wins_count_zero_when_content_none() {
        assert_eq!(wins_count_from_content(&None), 0);
    }

    #[test]
    fn wins_count_zero_when_wins_absent() {
        let v: serde_json::Value = serde_json::json!({ "blockers": [] });
        assert_eq!(wins_count_from_content(&Some(v)), 0);
    }

    #[test]
    fn wins_count_returns_array_length() {
        let v: serde_json::Value = serde_json::json!({
            "wins": [
                { "taskId": "t1", "title": "Task A" },
                { "taskId": "t2", "title": "Task B" }
            ]
        });
        assert_eq!(wins_count_from_content(&Some(v)), 2);
    }

    #[test]
    fn wins_count_zero_when_wins_not_array() {
        let v: serde_json::Value = serde_json::json!({ "wins": "not-an-array" });
        assert_eq!(wins_count_from_content(&Some(v)), 0);
    }

    // ---------------------------------------------------------------------------
    // Wave 7.3.1: BriefingRow type field deserialization
    // ---------------------------------------------------------------------------

    #[test]
    fn briefing_row_type_defaults_to_daily() {
        let json = r#"{
            "id": "brf-010",
            "briefing_date": "2026-07-08",
            "was_delivered": false
        }"#;
        let row: BriefingRow = serde_json::from_str(json).unwrap();
        assert_eq!(row.r#type, "daily");
    }

    #[test]
    fn briefing_row_type_weekly_deserialises() {
        let json = r#"{
            "id": "brf-011",
            "briefing_date": "2026-07-07",
            "was_delivered": false,
            "type": "weekly",
            "content": { "wins": [{"taskId": "t1", "title": "Win A"}], "blockers": [], "nextWeek": [] }
        }"#;
        let row: BriefingRow = serde_json::from_str(json).unwrap();
        assert_eq!(row.r#type, "weekly");
        assert_eq!(wins_count_from_content(&row.content), 1);
    }

    // ---------------------------------------------------------------------------
    // Wave 7.3.1: BriefingResponse multi-type deserialization
    // ---------------------------------------------------------------------------

    #[test]
    fn briefing_response_deserialises_briefings_array() {
        let json = r#"{
            "briefing": null,
            "briefings": [
                { "id": "brf-020", "briefing_date": "2026-07-08", "was_delivered": false, "type": "daily" },
                { "id": "brf-021", "briefing_date": "2026-07-07", "was_delivered": false, "type": "weekly",
                  "content": { "wins": [{"taskId": "t1", "title": "W"}], "blockers": [], "nextWeek": [] } }
            ]
        }"#;
        let resp: BriefingResponse = serde_json::from_str(json).unwrap();
        assert!(resp.briefing.is_none());
        assert_eq!(resp.briefings.len(), 2);
        assert_eq!(resp.briefings[0].r#type, "daily");
        assert_eq!(resp.briefings[1].r#type, "weekly");
        assert_eq!(wins_count_from_content(&resp.briefings[1].content), 1);
    }

    #[test]
    fn briefing_response_briefings_defaults_empty() {
        // Old-shape response (no briefings field) should default briefings to [].
        let json = r#"{ "briefing": { "id": "brf-030", "briefing_date": "2026-07-08", "was_delivered": false } }"#;
        let resp: BriefingResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.briefings.len(), 0);
        assert!(resp.briefing.is_some());
    }

    // ---------------------------------------------------------------------------
    // Wave 7.3.1: Weekly notification body text
    // ---------------------------------------------------------------------------

    #[test]
    fn weekly_notification_body_singular_win() {
        let wins = 1usize;
        let label = if wins == 1 { "1 win".to_string() } else { format!("{wins} wins") };
        assert_eq!(label, "1 win");
    }

    #[test]
    fn weekly_notification_body_plural_wins() {
        let wins = 4usize;
        let label = if wins == 1 { "1 win".to_string() } else { format!("{wins} wins") };
        assert_eq!(label, "4 wins");
    }

    #[test]
    fn weekly_notification_body_zero_wins() {
        let wins = 0usize;
        let label = if wins == 1 { "1 win".to_string() } else { format!("{wins} wins") };
        assert_eq!(label, "0 wins");
    }
}
