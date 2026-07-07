// THIN-SHELL CONSTRAINT (ADR-003, §13.2; ADR-013 §Security):
// This module polls the pending-approvals summary endpoint and fires a native
// notification when items are waiting. It contains:
//   - NO database client
//   - NO approval logic
//   - NO approval payload content — the endpoint structurally cannot supply it,
//     and this module never requests or stores any payload field
//
// The notification conveys ONLY:
//   - The count of pending items
//   - Metadata fields: action_type and provider (no subject, body, recipient, link)
//
// The deep-link click target is the web /approvals page, where the user reviews
// full payloads in the browser. The tray itself renders nothing beyond the toast.
//
// De-duplication strategy:
//   - In-memory HashSet<String> of already-alerted item ids (the `alerted_ids` set)
//   - A notification fires only when the incoming response contains ids NOT in the set
//   - When the queue returns empty (count == 0), the set is RESET so future items
//     will alert again (Test Case 4 semantics from the wave spec)
//   - On tray restart, the set is empty → a restart re-alerts still-pending items
//     (acceptable: they still need attention, per the wave spec's Notes section)

use std::collections::HashSet;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_notification::NotificationExt;

// ---------------------------------------------------------------------------
// API response shape — whitelist-only; no payload content
// ---------------------------------------------------------------------------

/// One pending approval item as returned by `GET /api/approvals/pending`.
///
/// Fields are the ONLY ones the endpoint returns (whitelist enforced server-side
/// per ADR-013 §Security — `payload` and `ai_summary` are never selected).
#[derive(Debug, Clone, Deserialize)]
pub struct PendingApprovalItem {
    /// Unique row id in the `approval_queue` table. Used as the de-dup key.
    pub id: String,
    /// The action type (e.g. "send_email", "create_calendar_event").
    pub action_type: String,
    /// The service provider (e.g. "gmail", "google_calendar").
    pub provider: String,
    /// ISO-8601 timestamp — for logging only, not displayed in the notification.
    pub created_at: String,
}

/// The response envelope: `{ count: N, items: [...] }`.
///
/// Empty queue: `{ count: 0, items: [] }` — 200, never 404.
#[derive(Debug, Deserialize)]
pub struct PendingApprovalsResponse {
    pub count: usize,
    pub items: Vec<PendingApprovalItem>,
}

// ---------------------------------------------------------------------------
// In-memory de-duplication state
// ---------------------------------------------------------------------------

/// In-memory set tracking which pending-approval item ids have already triggered
/// a notification. Prevents re-alerting the same items on every poll cycle.
///
/// Reset to empty when the queue returns `count == 0`, so future pending items
/// alert again.
///
/// Not persisted — intentionally thin. On restart, still-pending items may
/// re-alert, which is acceptable (they still need attention).
pub struct ApprovalAlertState {
    /// Item ids for which a notification has already been fired.
    /// `pub` so `poll.rs` can snapshot/writeback without holding a Mutex across
    /// an await boundary (lock-free-across-await pattern).
    pub alerted_ids: HashSet<String>,
}

impl ApprovalAlertState {
    pub fn new() -> Self {
        ApprovalAlertState {
            alerted_ids: HashSet::new(),
        }
    }

    /// Returns the set of ids from `items` that have NOT yet been alerted.
    ///
    /// These are the "new" items that should trigger a notification this cycle.
    pub fn new_item_ids<'a>(&self, items: &'a [PendingApprovalItem]) -> Vec<&'a PendingApprovalItem> {
        items
            .iter()
            .filter(|item| !self.alerted_ids.contains(&item.id))
            .collect()
    }

    /// Mark all items in `items` as alerted.
    pub fn mark_alerted(&mut self, items: &[PendingApprovalItem]) {
        for item in items {
            self.alerted_ids.insert(item.id.clone());
        }
    }

    /// Reset the alerted-ids set when the queue is empty.
    ///
    /// Called when the server returns `count == 0` so future pending items
    /// will alert again (Test Case 4: silence → new item → notification).
    pub fn reset_on_empty(&mut self) {
        if !self.alerted_ids.is_empty() {
            eprintln!(
                "[coriven-tray] approvals: queue empty — resetting {} alerted id(s)",
                self.alerted_ids.len()
            );
            self.alerted_ids.clear();
        }
    }

    /// Returns the count of currently tracked alerted ids (for logging/tests).
    pub fn alerted_count(&self) -> usize {
        self.alerted_ids.len()
    }
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/// Fetch the pending-approvals summary.
///
/// Returns:
/// - `Ok(response)` — 200 with the summary (possibly empty)
/// - `Err(...)` — network / auth / server error
///
/// A 404 is NOT expected from this endpoint (empty queue → 200 `{count:0,items:[]}`),
/// but is handled defensively as "no pending items" rather than an error.
pub async fn fetch_pending_approvals(
    api_base_url: &str,
    access_token: &str,
) -> Result<PendingApprovalsResponse, ApprovalFetchError> {
    let url = format!("{}/api/approvals/pending", api_base_url);
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        // SECURITY: Bearer token in header only — never logged, never in URL.
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| ApprovalFetchError::Network(e.to_string()))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(ApprovalFetchError::Unauthorized);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        // Defensive: treat as empty queue, not an error.
        return Ok(PendingApprovalsResponse {
            count: 0,
            items: vec![],
        });
    }
    if !status.is_success() {
        return Err(ApprovalFetchError::HttpError(status.as_u16()));
    }

    let result: PendingApprovalsResponse = response
        .json()
        .await
        .map_err(|e| ApprovalFetchError::ParseError(e.to_string()))?;

    Ok(result)
}

/// Error type for the approvals fetch. Intentionally coarse — no token or
/// approval content is embedded in any variant.
#[derive(Debug)]
pub enum ApprovalFetchError {
    Network(String),
    Unauthorized,
    HttpError(u16),
    ParseError(String),
}

impl std::fmt::Display for ApprovalFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApprovalFetchError::Network(e) => write!(f, "network: {e}"),
            ApprovalFetchError::Unauthorized => write!(f, "unauthorized (401)"),
            ApprovalFetchError::HttpError(c) => write!(f, "http {c}"),
            ApprovalFetchError::ParseError(e) => write!(f, "parse error: {e}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Notification body builder — metadata only, no payload content
// ---------------------------------------------------------------------------

/// Build the notification body from pending item metadata.
///
/// Only `action_type` and `provider` are used — both are whitelist metadata fields.
/// No subject, no recipient, no URL, no body content — by construction.
///
/// Pure function — no I/O, testable without Tauri.
pub fn build_approval_notification_body(new_items: &[&PendingApprovalItem]) -> String {
    if new_items.len() == 1 {
        let item = new_items[0];
        format!(
            "1 action awaiting your approval: {} via {}",
            item.action_type, item.provider
        )
    } else {
        // Summarise by unique action type for concise display.
        // Never group by subject/recipient/content — only metadata.
        let kinds: Vec<String> = new_items
            .iter()
            .map(|i| format!("{} ({})", i.action_type, i.provider))
            .collect();
        // Cap display at 3 kinds to keep toast readable.
        let display = if kinds.len() <= 3 {
            kinds.join(", ")
        } else {
            format!("{}, and {} more", kinds[..3].join(", "), kinds.len() - 3)
        };
        format!("{} actions awaiting approval: {}", new_items.len(), display)
    }
}

// ---------------------------------------------------------------------------
// Poll action: decide + notify + update state
// ---------------------------------------------------------------------------

/// Run one approvals poll action.
///
/// Called each poll cycle from `poll::run_poll_cycle`. The caller has already
/// verified the signed-in gate; `token` and `api_base_url` are extracted there.
///
/// Behavior:
/// 1. Fetch `GET /api/approvals/pending`.
/// 2. If count == 0 → reset de-dup state, return (silence).
/// 3. Compute new_items = items whose ids are NOT in `alerted_ids`.
/// 4. If no new items → return (silence, same pending items re-polled).
/// 5. Fire one notification for the new items.
/// 6. Mark all items (new and existing) as alerted.
pub async fn run_approvals_poll(
    app: &AppHandle,
    alert_state: &mut ApprovalAlertState,
    token: &str,
    api_base_url: &str,
) {
    eprintln!("[coriven-tray] approvals: polling /api/approvals/pending");

    let response = match fetch_pending_approvals(api_base_url, token).await {
        Ok(r) => r,
        Err(ApprovalFetchError::Unauthorized) => {
            // The main poll loop handles the 401 event; just log here.
            eprintln!("[coriven-tray] approvals: 401 on poll — skipping cycle");
            return;
        }
        Err(e) => {
            eprintln!("[coriven-tray] approvals: poll failed ({e}) — skipping cycle");
            return;
        }
    };

    eprintln!(
        "[coriven-tray] approvals: {} pending item(s) in response",
        response.count
    );

    // Step 2: empty queue → reset de-dup state.
    if response.count == 0 {
        alert_state.reset_on_empty();
        return;
    }

    // Step 3: find new (not-yet-alerted) items.
    let new_items = alert_state.new_item_ids(&response.items);

    if new_items.is_empty() {
        eprintln!(
            "[coriven-tray] approvals: all {} item(s) already alerted — silent",
            response.items.len()
        );
        return;
    }

    eprintln!(
        "[coriven-tray] approvals: {} new item(s) to notify (total pending: {})",
        new_items.len(),
        response.count
    );

    // Step 5: fire one notification for the new items.
    let title = "Actions awaiting your approval";
    let body = build_approval_notification_body(&new_items);

    match app
        .notification()
        .builder()
        .title(title)
        .body(&body)
        .show()
    {
        Ok(()) => {
            eprintln!(
                "[coriven-tray] approvals: notification fired ({} new item(s))",
                new_items.len()
            );
        }
        Err(e) => {
            eprintln!("[coriven-tray] approvals: notification dispatch failed: {e}");
            // Do NOT mark as alerted — we didn't actually notify.
            return;
        }
    }

    // Step 6: mark ALL current items as alerted (new + existing).
    // This ensures that if the same items appear next cycle, they stay silent.
    alert_state.mark_alerted(&response.items);
}

/// Open the Coriven web app's /approvals page in the default browser.
/// Deep-link target per the wave spec — raw payload review stays in the web UI.
pub fn open_approvals_page(app: &AppHandle, web_app_url: &str) {
    let url = format!("{}/approvals", web_app_url);
    if let Err(e) = app.opener().open_url(&url, None::<&str>) {
        eprintln!("[coriven-tray] approvals: failed to open approvals page at {url}: {e}");
    }
}

// ---------------------------------------------------------------------------
// Deep-link URL construction (pure — testable without Tauri)
// ---------------------------------------------------------------------------

/// Build the briefing deep-link URL.
///
/// Pure function — testable without Tauri or a running app.
pub fn today_page_url(web_app_url: &str) -> String {
    format!("{}/today", web_app_url)
}

/// Build the approvals deep-link URL.
///
/// Pure function — testable without Tauri or a running app.
pub fn approvals_page_url(web_app_url: &str) -> String {
    format!("{}/approvals", web_app_url)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------------
    // Response deserialization
    // ---------------------------------------------------------------------------

    #[test]
    fn empty_response_deserialises() {
        let json = r#"{"count": 0, "items": []}"#;
        let resp: PendingApprovalsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.count, 0);
        assert!(resp.items.is_empty());
    }

    #[test]
    fn response_with_items_deserialises() {
        let json = r#"{
            "count": 2,
            "items": [
                {
                    "id": "appr-001",
                    "action_type": "send_email",
                    "provider": "gmail",
                    "created_at": "2026-07-04T09:00:00Z"
                },
                {
                    "id": "appr-002",
                    "action_type": "create_calendar_event",
                    "provider": "google_calendar",
                    "created_at": "2026-07-04T09:01:00Z"
                }
            ]
        }"#;
        let resp: PendingApprovalsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.count, 2);
        assert_eq!(resp.items.len(), 2);
        assert_eq!(resp.items[0].id, "appr-001");
        assert_eq!(resp.items[0].action_type, "send_email");
        assert_eq!(resp.items[0].provider, "gmail");
        assert_eq!(resp.items[1].action_type, "create_calendar_event");
    }

    // ---------------------------------------------------------------------------
    // ApprovalAlertState — de-duplication (Test Case 4 from the wave spec)
    // ---------------------------------------------------------------------------

    fn make_item(id: &str, action_type: &str, provider: &str) -> PendingApprovalItem {
        PendingApprovalItem {
            id: id.to_string(),
            action_type: action_type.to_string(),
            provider: provider.to_string(),
            created_at: "2026-07-04T09:00:00Z".to_string(),
        }
    }

    #[test]
    fn alert_state_starts_empty() {
        let state = ApprovalAlertState::new();
        assert_eq!(state.alerted_count(), 0);
    }

    #[test]
    fn new_items_all_returned_when_state_empty() {
        let state = ApprovalAlertState::new();
        let items = vec![
            make_item("appr-A", "send_email", "gmail"),
            make_item("appr-B", "create_calendar_event", "google_calendar"),
        ];
        let new = state.new_item_ids(&items);
        assert_eq!(new.len(), 2);
    }

    /// Test Case 4 — Poll 1: {A, B} → notify; Poll 2: {A, B} → silent.
    #[test]
    fn already_alerted_items_are_suppressed() {
        let mut state = ApprovalAlertState::new();
        let items = vec![
            make_item("appr-A", "send_email", "gmail"),
            make_item("appr-B", "create_calendar_event", "google_calendar"),
        ];

        // Poll 1: both are new.
        let new_1 = state.new_item_ids(&items);
        assert_eq!(new_1.len(), 2);
        state.mark_alerted(&items);

        // Poll 2: same items — all already alerted.
        let new_2 = state.new_item_ids(&items);
        assert_eq!(new_2.len(), 0, "Poll 2 must be silent for already-alerted items");
    }

    /// Test Case 4 — Poll 3: {A, B, C} → only C is new.
    #[test]
    fn new_item_in_subsequent_poll_fires_notification() {
        let mut state = ApprovalAlertState::new();
        let items_poll_1 = vec![
            make_item("appr-A", "send_email", "gmail"),
            make_item("appr-B", "create_calendar_event", "google_calendar"),
        ];
        state.mark_alerted(&items_poll_1);

        // Poll 3: A, B, and new C.
        let items_poll_3 = vec![
            make_item("appr-A", "send_email", "gmail"),
            make_item("appr-B", "create_calendar_event", "google_calendar"),
            make_item("appr-C", "send_email", "gmail"),
        ];
        let new_3 = state.new_item_ids(&items_poll_3);
        assert_eq!(new_3.len(), 1);
        assert_eq!(new_3[0].id, "appr-C");
    }

    /// Test Case 4 — Poll 4: {} → reset; Poll 5: {D} → notify again.
    #[test]
    fn reset_on_empty_allows_future_alerts() {
        let mut state = ApprovalAlertState::new();

        // Fill state with some alerted items.
        let items = vec![make_item("appr-A", "send_email", "gmail")];
        state.mark_alerted(&items);
        assert_eq!(state.alerted_count(), 1);

        // Poll 4: empty response → reset.
        state.reset_on_empty();
        assert_eq!(state.alerted_count(), 0);

        // Poll 5: new item D → it is new (state was reset).
        let items_poll_5 = vec![make_item("appr-D", "send_email", "gmail")];
        let new_5 = state.new_item_ids(&items_poll_5);
        assert_eq!(new_5.len(), 1);
        assert_eq!(new_5[0].id, "appr-D");
    }

    #[test]
    fn reset_on_empty_when_already_empty_is_noop() {
        let mut state = ApprovalAlertState::new();
        // Should not panic.
        state.reset_on_empty();
        assert_eq!(state.alerted_count(), 0);
    }

    // ---------------------------------------------------------------------------
    // Notification body builder — metadata only, no payload content
    // ---------------------------------------------------------------------------

    #[test]
    fn single_item_body_contains_action_type_and_provider() {
        let item = make_item("appr-001", "send_email", "gmail");
        let refs = vec![&item];
        let body = build_approval_notification_body(&refs);
        assert!(body.contains("send_email"), "body must include action_type");
        assert!(body.contains("gmail"), "body must include provider");
        assert!(body.contains("1 action"), "singular form for one item");
        // Must NOT contain any payload-like content markers.
        assert!(!body.contains("subject"));
        assert!(!body.contains("recipient"));
        assert!(!body.contains("body"));
    }

    #[test]
    fn two_items_body_uses_plural_and_lists_both() {
        let item_a = make_item("appr-A", "send_email", "gmail");
        let item_b = make_item("appr-B", "create_calendar_event", "google_calendar");
        let refs = vec![&item_a, &item_b];
        let body = build_approval_notification_body(&refs);
        assert!(body.contains("2 actions"), "plural for two items");
        assert!(body.contains("send_email"));
        assert!(body.contains("create_calendar_event"));
    }

    #[test]
    fn many_items_body_caps_at_three_plus_overflow() {
        let items: Vec<PendingApprovalItem> = (0..5)
            .map(|i| make_item(&format!("appr-{i}"), "send_email", "gmail"))
            .collect();
        let refs: Vec<&PendingApprovalItem> = items.iter().collect();
        let body = build_approval_notification_body(&refs);
        assert!(body.contains("5 actions"), "must show correct count");
        assert!(body.contains("and 2 more"), "must cap display at 3 + overflow");
    }

    // ---------------------------------------------------------------------------
    // Deep-link URL construction — pure function tests
    // ---------------------------------------------------------------------------

    #[test]
    fn today_page_url_appends_today_path() {
        let url = today_page_url("http://localhost:3000");
        assert_eq!(url, "http://localhost:3000/today");
    }

    #[test]
    fn today_page_url_works_with_production_url() {
        let url = today_page_url("https://app.coriven.ai");
        assert_eq!(url, "https://app.coriven.ai/today");
    }

    #[test]
    fn approvals_page_url_appends_approvals_path() {
        let url = approvals_page_url("http://localhost:3000");
        assert_eq!(url, "http://localhost:3000/approvals");
    }

    #[test]
    fn approvals_page_url_works_with_production_url() {
        let url = approvals_page_url("https://app.coriven.ai");
        assert_eq!(url, "https://app.coriven.ai/approvals");
    }

    // ---------------------------------------------------------------------------
    // ApprovalFetchError display (no sensitive content)
    // ---------------------------------------------------------------------------

    #[test]
    fn fetch_error_display_has_no_secret_values() {
        let cases = [
            ApprovalFetchError::Network("connection refused".to_string()),
            ApprovalFetchError::Unauthorized,
            ApprovalFetchError::HttpError(500),
            ApprovalFetchError::ParseError("unexpected field".to_string()),
        ];
        for e in &cases {
            let s = e.to_string();
            assert!(!s.contains("Bearer"));
            assert!(!s.contains("token"));
        }
    }

    // ---------------------------------------------------------------------------
    // mark_alerted does not double-count (idempotent insert into HashSet)
    // ---------------------------------------------------------------------------

    #[test]
    fn mark_alerted_is_idempotent() {
        let mut state = ApprovalAlertState::new();
        let items = vec![make_item("appr-Z", "send_email", "gmail")];
        state.mark_alerted(&items);
        state.mark_alerted(&items);
        // HashSet deduplicates — must still be exactly 1.
        assert_eq!(state.alerted_count(), 1);
    }
}
