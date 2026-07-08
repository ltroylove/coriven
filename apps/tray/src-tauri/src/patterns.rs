// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This module polls the /api/patterns/new endpoint and fires native notifications
// for newly detected behavioral patterns. It contains:
//   - NO database client
//   - NO pattern detection logic
//   - NO frequency-cap computation (cap is enforced server-side)
// The backend API owns all business logic; the tray fires only what the API returns.
//
// Notification behavior:
//   - No sound (informational-only, per calm-proactivity principle UX §4.1)
//   - Body ≤ 100 characters (enforced by truncation before display)
//   - Acknowledge endpoint called immediately after firing each notification

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/// A single pattern from GET /api/patterns/new.
#[derive(Debug, Clone, Deserialize)]
pub struct NewPatternItem {
    /// UUID of the detected_patterns row.
    pub id: String,
    /// The pattern type (e.g. "gym_days").
    pub pattern_type: String,
    /// Human-readable description — used as notification body.
    pub description: String,
    /// ISO-8601 timestamp when the pattern was last detected.
    pub last_detected_at: String,
}

/// The response envelope: `{ patterns: [...] }`.
#[derive(Debug, Deserialize)]
pub struct NewPatternsResponse {
    pub patterns: Vec<NewPatternItem>,
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Error type for pattern poll operations.
#[derive(Debug)]
pub enum PatternPollError {
    Network(String),
    Unauthorized,
    HttpError(u16),
    ParseError(String),
}

impl std::fmt::Display for PatternPollError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PatternPollError::Network(e) => write!(f, "network: {e}"),
            PatternPollError::Unauthorized => write!(f, "unauthorized (401)"),
            PatternPollError::HttpError(c) => write!(f, "http {c}"),
            PatternPollError::ParseError(e) => write!(f, "parse error: {e}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum body length for a pattern notification (native OS constraint).
pub const MAX_NOTIFICATION_BODY_CHARS: usize = 100;

/// Notification title for detected patterns.
const PATTERN_NOTIFICATION_TITLE: &str = "Coriven noticed a pattern";

// ---------------------------------------------------------------------------
// Pure functions (testable without Tauri)
// ---------------------------------------------------------------------------

/// Truncate a description to MAX_NOTIFICATION_BODY_CHARS characters.
/// Appends "…" if truncated. Returns a String always ≤ 100 chars.
pub fn truncate_description(description: &str) -> String {
    let chars: Vec<char> = description.chars().collect();
    if chars.len() <= MAX_NOTIFICATION_BODY_CHARS {
        return description.to_string();
    }
    // Truncate to 99 chars and append ellipsis (total ≤ 100).
    let truncated: String = chars[..99].iter().collect();
    format!("{truncated}…")
}

/// Decide whether to fire a pattern notification.
/// Returns true — the server already enforces the frequency cap; the tray fires all
/// returned patterns. This function exists as a pure seam for testing.
pub fn should_notify_pattern(_item: &NewPatternItem) -> bool {
    true
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/// Fetch new patterns from /api/patterns/new.
pub async fn fetch_new_patterns(
    api_base_url: &str,
    access_token: &str,
) -> Result<Vec<NewPatternItem>, PatternPollError> {
    let url = format!("{}/api/patterns/new", api_base_url);
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| PatternPollError::Network(e.to_string()))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(PatternPollError::Unauthorized);
    }
    if !status.is_success() {
        return Err(PatternPollError::HttpError(status.as_u16()));
    }

    let envelope: NewPatternsResponse = response
        .json()
        .await
        .map_err(|e| PatternPollError::ParseError(e.to_string()))?;

    Ok(envelope.patterns)
}

/// Acknowledge a pattern notification via POST /api/patterns/[id]/acknowledge.
/// Errors are logged but do not abort the caller.
pub async fn acknowledge_pattern(
    api_base_url: &str,
    access_token: &str,
    pattern_id: &str,
) -> bool {
    let url = format!("{}/api/patterns/{}/acknowledge", api_base_url, pattern_id);
    let client = reqwest::Client::new();

    match client
        .post(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            eprintln!(
                "[coriven-tray] patterns: acknowledge returned {} for pattern_id={}",
                resp.status().as_u16(),
                pattern_id
            );
            false
        }
        Err(e) => {
            eprintln!(
                "[coriven-tray] patterns: acknowledge network error for pattern_id={}: {}",
                pattern_id, e
            );
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Poll action
// ---------------------------------------------------------------------------

/// Run one pattern poll cycle.
///
/// Called from `poll::run_poll_cycle` alongside the reminder and briefing channels.
/// Errors in this function MUST NOT propagate to the caller — they are logged
/// and the function returns early, preserving reminder and briefing poll stability.
///
/// Steps:
///   1. Fetch /api/patterns/new
///   2. For each returned pattern: fire notification (no sound, ≤ 100 chars)
///   3. Call acknowledge endpoint for each successfully fired notification
pub async fn run_patterns_poll(app: &AppHandle, token: &str, api_base_url: &str) {
    eprintln!("[coriven-tray] patterns: polling /api/patterns/new");

    let patterns = match fetch_new_patterns(api_base_url, token).await {
        Ok(p) => p,
        Err(PatternPollError::Unauthorized) => {
            // The main poll loop already handles 401 for the reminder channel.
            // Log only — do not re-emit auth event (poll.rs handles that).
            eprintln!("[coriven-tray] patterns: 401 — skipping cycle (session handled by reminder channel)");
            return;
        }
        Err(e) => {
            eprintln!("[coriven-tray] patterns: fetch failed ({e}) — skipping cycle");
            return;
        }
    };

    eprintln!(
        "[coriven-tray] patterns: {} new pattern(s) to notify",
        patterns.len()
    );

    for item in &patterns {
        if !should_notify_pattern(item) {
            continue;
        }

        let body = truncate_description(&item.description);

        // Fire notification — no sound (informational only per UX §4.1)
        match app
            .notification()
            .builder()
            .title(PATTERN_NOTIFICATION_TITLE)
            .body(&body)
            .show()
        {
            Ok(()) => {
                eprintln!(
                    "[coriven-tray] patterns: notification fired for pattern_id={}",
                    item.id
                );

                // Acknowledge immediately after firing so frequency cap updates server-side
                acknowledge_pattern(api_base_url, token, &item.id).await;
            }
            Err(e) => {
                eprintln!(
                    "[coriven-tray] patterns: notification dispatch failed for pattern_id={}: {e}",
                    item.id
                );
                // Do NOT acknowledge — we didn't actually notify; will retry next cycle
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pattern(id: &str, pattern_type: &str, description: &str) -> NewPatternItem {
        NewPatternItem {
            id: id.to_string(),
            pattern_type: pattern_type.to_string(),
            description: description.to_string(),
            last_detected_at: "2026-07-08T03:00:00Z".to_string(),
        }
    }

    // ---------------------------------------------------------------------------
    // truncate_description
    // ---------------------------------------------------------------------------

    #[test]
    fn truncate_short_description_unchanged() {
        let s = "You tend to work out on Tuesday";
        let result = truncate_description(s);
        assert_eq!(result, s);
        assert!(result.chars().count() <= MAX_NOTIFICATION_BODY_CHARS);
    }

    #[test]
    fn truncate_exactly_100_chars_unchanged() {
        let s: String = "a".repeat(MAX_NOTIFICATION_BODY_CHARS);
        let result = truncate_description(&s);
        assert_eq!(result, s);
        assert_eq!(result.chars().count(), MAX_NOTIFICATION_BODY_CHARS);
    }

    #[test]
    fn truncate_101_chars_truncated_to_100() {
        let s: String = "a".repeat(MAX_NOTIFICATION_BODY_CHARS + 1);
        let result = truncate_description(&s);
        // 99 'a' chars + '…' = 100 chars
        assert_eq!(result.chars().count(), MAX_NOTIFICATION_BODY_CHARS);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn truncate_long_description_within_limit() {
        let s: String = "x".repeat(200);
        let result = truncate_description(&s);
        assert!(result.chars().count() <= MAX_NOTIFICATION_BODY_CHARS);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn truncate_empty_string_unchanged() {
        let result = truncate_description("");
        assert_eq!(result, "");
    }

    // ---------------------------------------------------------------------------
    // should_notify_pattern
    // ---------------------------------------------------------------------------

    #[test]
    fn should_notify_returns_true_for_any_pattern() {
        let p = make_pattern("pat-001", "gym_days", "You tend to work out on Tuesday");
        assert!(should_notify_pattern(&p));
    }

    // ---------------------------------------------------------------------------
    // NewPatternItem deserialization
    // ---------------------------------------------------------------------------

    #[test]
    fn new_pattern_item_deserializes() {
        let json = r#"{
            "id": "uuid-abc",
            "pattern_type": "gym_days",
            "description": "You tend to go to the gym on Tuesdays and Thursdays",
            "last_detected_at": "2026-07-08T03:00:00Z"
        }"#;
        let item: NewPatternItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "uuid-abc");
        assert_eq!(item.pattern_type, "gym_days");
        assert_eq!(item.description, "You tend to go to the gym on Tuesdays and Thursdays");
    }

    #[test]
    fn new_patterns_response_deserializes_empty() {
        let json = r#"{"patterns": []}"#;
        let resp: NewPatternsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.patterns.len(), 0);
    }

    #[test]
    fn new_patterns_response_deserializes_multiple() {
        let json = r#"{
            "patterns": [
                {
                    "id": "p1",
                    "pattern_type": "gym_days",
                    "description": "You work out on Tuesdays",
                    "last_detected_at": "2026-07-08T03:00:00Z"
                },
                {
                    "id": "p2",
                    "pattern_type": "stale_goal",
                    "description": "Goal \"Ship v1\" has no recent activity",
                    "last_detected_at": "2026-07-07T03:00:00Z"
                }
            ]
        }"#;
        let resp: NewPatternsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.patterns.len(), 2);
        assert_eq!(resp.patterns[0].id, "p1");
        assert_eq!(resp.patterns[1].pattern_type, "stale_goal");
    }

    // ---------------------------------------------------------------------------
    // PatternPollError display (no sensitive content)
    // ---------------------------------------------------------------------------

    #[test]
    fn pattern_poll_error_display_has_no_secrets() {
        let cases = [
            PatternPollError::Network("connection refused".to_string()),
            PatternPollError::Unauthorized,
            PatternPollError::HttpError(500),
            PatternPollError::ParseError("unexpected field".to_string()),
        ];
        for e in &cases {
            let s = e.to_string();
            assert!(!s.contains("Bearer"));
            assert!(!s.contains("token"));
        }
    }
}
