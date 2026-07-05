// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This module polls the backend due-reminders endpoint and fires native
// notifications. It contains:
//   - NO database client
//   - NO recurrence computation
//   - NO "what's due" rules beyond comparing the API-provided fire time to now
// The backend API owns all business logic; the tray fires only what the API returns.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::time;

use crate::{
    auth::{AuthState, AuthStatus},
    notify::{dispatch_notification, NotificationMeta},
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Poll interval. ~5 minutes as specified by Blueprint §13.3.
pub const POLL_INTERVAL: Duration = Duration::from_secs(5 * 60);

// ---------------------------------------------------------------------------
// API response shape
// ---------------------------------------------------------------------------

/// A single due reminder as returned by `GET /api/tasks/due`.
///
/// Field names are the exact column names from the `task_reminders` table
/// joined with `tasks`. Confirmed from `apps/web/src/app/api/tasks/due/route.ts`:
///   - `.select('*, task:tasks(title, status)')`
///   - Returns `task_reminders` rows with embedded `task: { title, status }`.
///
/// The "effective fire time" for de-dup is:
///   snoozed_until if snoozed_until is Some and > remind_at, else remind_at.
/// Both values come VERBATIM from the API — no recurrence math here.
#[derive(Debug, Clone, Deserialize)]
pub struct DueReminder {
    /// Primary key of the `task_reminders` row.
    pub id: String,
    /// The scheduled remind time (ISO-8601).
    pub remind_at: String,
    /// Non-null if the reminder is snoozed; the snooze expiry time (ISO-8601).
    pub snoozed_until: Option<String>,
    /// Joined task details. The API filters out null tasks (completed/cancelled).
    pub task: ReminderTask,
}

/// Embedded task fields joined from `tasks`.
#[derive(Debug, Clone, Deserialize)]
pub struct ReminderTask {
    pub title: String,
    // `status` is not used by the tray; the API already excludes done/cancelled tasks.
    // Included to match the full select shape so unexpected fields don't break parsing.
    #[allow(dead_code)]
    pub status: Option<String>,
}

// ---------------------------------------------------------------------------
// De-dup key
// ---------------------------------------------------------------------------

/// Compute the de-dup key for a reminder occurrence.
///
/// Key = `reminderId|effectiveFireTime` where effective fire time is:
///   `snoozed_until` (if present), else `remind_at`.
/// Both values are taken verbatim from the API payload — no parsing or math.
///
/// This is a pure function testable without any Tauri or OS context.
pub fn dedup_key(reminder: &DueReminder) -> String {
    let fire_time = reminder
        .snoozed_until
        .as_deref()
        .unwrap_or(reminder.remind_at.as_str());
    format!("{}|{}", reminder.id, fire_time)
}

/// Compute the effective fire time string for display in the notification body.
pub fn effective_fire_time(reminder: &DueReminder) -> &str {
    reminder
        .snoozed_until
        .as_deref()
        .unwrap_or(reminder.remind_at.as_str())
}

// ---------------------------------------------------------------------------
// Should-notify decision
// ---------------------------------------------------------------------------

/// Decide whether to fire a notification for this reminder given the current
/// already-notified set.
///
/// Returns `true` if the reminder's de-dup key is NOT in `already_notified`.
/// This is a pure function — no side effects, no OS calls.
pub fn should_notify(reminder: &DueReminder, already_notified: &HashSet<String>) -> bool {
    !already_notified.contains(&dedup_key(reminder))
}

// ---------------------------------------------------------------------------
// Persisted de-dup cache
// ---------------------------------------------------------------------------

/// Persisted already-notified set.
///
/// Stored as a JSON array in the Tauri app-data directory so it survives
/// tray restarts (preventing replay of old toasts on relaunch).
/// This file contains NO tokens and NO sensitive data — only reminder ids
/// and ISO-8601 timestamps.
pub struct DedupeCache {
    inner: HashSet<String>,
    path: std::path::PathBuf,
}

impl DedupeCache {
    /// Load the cache from disk, or start with an empty set if absent/malformed.
    pub fn load(app: &AppHandle) -> Self {
        let path = cache_path(app);
        let inner = try_load_cache(&path).unwrap_or_default();
        eprintln!(
            "[coriven-tray] poll: dedup cache loaded ({} entries) from {}",
            inner.len(),
            path.display()
        );
        DedupeCache { inner, path }
    }

    /// Return true if this key has already been notified.
    pub fn contains(&self, key: &str) -> bool {
        self.inner.contains(key)
    }

    /// Mark a key as notified and persist the updated set.
    pub fn insert(&mut self, key: String) {
        self.inner.insert(key);
        self.persist();
    }

    /// Prune entries whose keys are NOT in `live_keys`.
    /// Called each cycle to prevent unbounded cache growth.
    pub fn prune(&mut self, live_keys: &HashSet<String>) {
        let before = self.inner.len();
        self.inner.retain(|k| live_keys.contains(k));
        let pruned = before - self.inner.len();
        if pruned > 0 {
            eprintln!("[coriven-tray] poll: dedup cache pruned {pruned} stale entries");
            self.persist();
        }
    }

    fn persist(&self) {
        let keys: Vec<&String> = self.inner.iter().collect();
        match serde_json::to_string(&keys) {
            Ok(json) => {
                if let Some(parent) = self.path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&self.path, json) {
                    eprintln!("[coriven-tray] poll: failed to persist dedup cache: {e}");
                }
            }
            Err(e) => {
                eprintln!("[coriven-tray] poll: failed to serialize dedup cache: {e}");
            }
        }
    }
}

/// Resolve the app-data path for the de-dup cache file.
fn cache_path(app: &AppHandle) -> std::path::PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    data_dir.join("notified-cache.json")
}

/// Try to read and parse the cache file. Returns None on any error.
fn try_load_cache(path: &std::path::Path) -> Option<HashSet<String>> {
    let bytes = std::fs::read(path).ok()?;
    let keys: Vec<String> = serde_json::from_slice(&bytes).ok()?;
    Some(keys.into_iter().collect())
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

/// Shared poll state — accessible from the background Tokio task.
pub struct PollState {
    /// Base URL for the Coriven web API (e.g. http://localhost:3000 in dev).
    pub api_base_url: String,
}

impl PollState {
    pub fn new(api_base_url: String) -> Self {
        PollState { api_base_url }
    }
}

/// Start the background poll loop as a Tokio task.
///
/// Fires immediately at startup (so reminders that fell due while the tray was
/// off are delivered on launch), then repeats every `POLL_INTERVAL`.
///
/// The loop only polls when auth state is `SignedIn`. Other states are skipped
/// silently so no error is logged on a fresh launch before sign-in.
pub fn start_poll_loop(app: AppHandle, poll_state: Arc<Mutex<PollState>>) {
    tokio::spawn(async move {
        // Immediate startup poll.
        run_poll_cycle(&app, &poll_state).await;

        // Then on a repeating interval.
        let mut interval = time::interval(POLL_INTERVAL);
        interval.tick().await; // consume the first (immediate) tick
        loop {
            interval.tick().await;
            run_poll_cycle(&app, &poll_state).await;
        }
    });
}

/// Execute one poll cycle: fetch, decide, notify, update cache.
async fn run_poll_cycle(app: &AppHandle, poll_state: &Arc<Mutex<PollState>>) {
    // Read auth state. If not signed in, skip silently.
    let (token, api_base_url) = {
        let auth_state = app.state::<AuthState>();
        let (status, opt_token) = match auth_state.get_session() {
            Ok(pair) => pair,
            Err(_) => {
                eprintln!("[coriven-tray] poll: auth state lock poisoned — skipping cycle");
                return;
            }
        };
        if status != AuthStatus::SignedIn {
            // Not an error — user may not have signed in yet.
            return;
        }
        let token = match opt_token {
            Some(t) => t,
            None => {
                eprintln!("[coriven-tray] poll: signed_in state but no token — skipping cycle");
                return;
            }
        };
        let base = {
            let ps = match poll_state.lock() {
                Ok(g) => g,
                Err(_) => {
                    eprintln!("[coriven-tray] poll: poll_state lock poisoned — skipping cycle");
                    return;
                }
            };
            ps.api_base_url.clone()
        };
        (token, base)
    };

    let url = format!("{}/api/tasks/due", api_base_url);
    eprintln!("[coriven-tray] poll: fetching due reminders");

    // Fetch due reminders from the backend.
    let reminders = match fetch_due_reminders(&url, &token).await {
        Ok(r) => r,
        Err(e) => {
            // Log error class only — no token, no reminder content.
            eprintln!("[coriven-tray] poll: fetch failed ({}); skipping cycle", e);
            return;
        }
    };

    eprintln!(
        "[coriven-tray] poll: {} reminder(s) returned by API",
        reminders.len()
    );

    // Load the persisted de-dup cache.
    let mut cache = DedupeCache::load(app);

    // Build the set of live keys from this response (used for pruning).
    let live_keys: HashSet<String> = reminders.iter().map(|r| dedup_key(r)).collect();

    // Prune stale entries — removes keys absent from this response.
    cache.prune(&live_keys);

    let mut fired = 0usize;
    let mut suppressed = 0usize;

    for reminder in &reminders {
        let key = dedup_key(reminder);

        if cache.contains(&key) {
            suppressed += 1;
            continue;
        }

        // The only "due" decision the tray makes: is the effective fire time <= now?
        // The API already returns only reminders due within 24h; this comparison is
        // presentation timing, not a business rule.
        let fire_time_str = effective_fire_time(reminder);
        if !is_at_or_before_now(fire_time_str) {
            // Future reminder within the 24h window — hold; do not notify yet.
            continue;
        }

        let title = &reminder.task.title;
        let body = format!("Due: {}", fire_time_str);
        let meta = NotificationMeta {
            reminder_id: reminder.id.clone(),
            effective_fire_time: fire_time_str.to_string(),
        };

        match dispatch_notification(app, title, &body, &meta) {
            Ok(()) => {
                cache.insert(key);
                fired += 1;
            }
            Err(e) => {
                // Log error class; do NOT log title (reminder content).
                eprintln!("[coriven-tray] poll: notification dispatch error: {e}");
            }
        }
    }

    eprintln!(
        "[coriven-tray] poll: cycle complete — fired={fired} suppressed={suppressed}"
    );
}

/// Fetch due reminders from the API.
///
/// On a 401 response the caller should trigger token refresh (future enhancement —
/// current session is not automatically refreshed in Wave 6.2.1 because the
/// refresh token path requires webview interaction; a 401 is logged and skipped).
///
/// TODO(wave-6.2.2): Wire the Feature 6.1 refresh path here on 401 so silent
/// token renewal happens in the background without requiring the user to re-open
/// the sign-in window.
async fn fetch_due_reminders(
    url: &str,
    access_token: &str,
) -> Result<Vec<DueReminder>, FetchError> {
    let client = reqwest::Client::new();
    // SECURITY: Bearer token is in the Authorization header only — not in the URL,
    // not in any log line below.
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(FetchError::Unauthorized);
    }
    if !status.is_success() {
        return Err(FetchError::HttpError(status.as_u16()));
    }

    // Parse the response. A malformed response is rejected wholesale — never
    // partially applied (which could cause duplicate or missing notifications).
    let reminders: Vec<DueReminder> = response
        .json()
        .await
        .map_err(|e| FetchError::ParseError(e.to_string()))?;

    Ok(reminders)
}

/// Error type for the fetch operation. Intentionally coarse — no token or
/// reminder content is embedded in any variant.
#[derive(Debug)]
pub enum FetchError {
    Network(String),
    Unauthorized,
    HttpError(u16),
    ParseError(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::Network(e) => write!(f, "network: {e}"),
            FetchError::Unauthorized => write!(f, "unauthorized (401) — session may be expired"),
            FetchError::HttpError(code) => write!(f, "http {code}"),
            FetchError::ParseError(e) => write!(f, "parse error: {e}"),
        }
    }
}

/// Compare the ISO-8601 fire time string to the current UTC clock.
/// Returns true if fire_time <= now.
///
/// This is the ONLY "due" comparison the tray performs — it is presentation
/// timing, not a business rule. The API already decided which reminders to
/// include in the response.
fn is_at_or_before_now(fire_time: &str) -> bool {
    // Parse the ISO-8601 string. If parsing fails, treat as not-due so we
    // never fire a notification based on garbage data.
    match chrono::DateTime::parse_from_rfc3339(fire_time) {
        Ok(dt) => dt <= chrono::Utc::now(),
        Err(_) => {
            eprintln!("[coriven-tray] poll: unparseable fire time '{fire_time}' — holding");
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: build a DueReminder with no snooze.
    fn make_reminder(id: &str, remind_at: &str) -> DueReminder {
        DueReminder {
            id: id.to_string(),
            remind_at: remind_at.to_string(),
            snoozed_until: None,
            task: ReminderTask {
                title: format!("Task for {id}"),
                status: Some("pending".to_string()),
            },
        }
    }

    // Helper: build a DueReminder that has been snoozed.
    fn make_snoozed_reminder(id: &str, remind_at: &str, snoozed_until: &str) -> DueReminder {
        DueReminder {
            id: id.to_string(),
            remind_at: remind_at.to_string(),
            snoozed_until: Some(snoozed_until.to_string()),
            task: ReminderTask {
                title: format!("Task for {id}"),
                status: Some("pending".to_string()),
            },
        }
    }

    // ---------------------------------------------------------------------------
    // De-dup key tests
    // ---------------------------------------------------------------------------

    #[test]
    fn dedup_key_uses_remind_at_when_no_snooze() {
        let r = make_reminder("rem-001", "2026-07-04T10:00:00Z");
        assert_eq!(dedup_key(&r), "rem-001|2026-07-04T10:00:00Z");
    }

    #[test]
    fn dedup_key_uses_snoozed_until_when_present() {
        let r = make_snoozed_reminder(
            "rem-002",
            "2026-07-04T10:00:00Z",
            "2026-07-04T10:30:00Z",
        );
        // Effective fire time = snoozed_until, not remind_at.
        assert_eq!(dedup_key(&r), "rem-002|2026-07-04T10:30:00Z");
    }

    #[test]
    fn different_occurrence_same_id_produces_different_keys() {
        let r1 = make_snoozed_reminder(
            "rem-003",
            "2026-07-04T10:00:00Z",
            "2026-07-04T10:30:00Z",
        );
        let r2 = make_snoozed_reminder(
            "rem-003",
            "2026-07-04T10:00:00Z",
            "2026-07-04T11:00:00Z",
        );
        assert_ne!(dedup_key(&r1), dedup_key(&r2));
    }

    #[test]
    fn key_format_is_id_pipe_fire_time() {
        let r = make_reminder("abc-123", "2026-07-04T09:00:00Z");
        let key = dedup_key(&r);
        // Must be "<id>|<fire_time>" with exactly one pipe.
        let parts: Vec<&str> = key.splitn(2, '|').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "abc-123");
        assert_eq!(parts[1], "2026-07-04T09:00:00Z");
    }

    // ---------------------------------------------------------------------------
    // should_notify tests
    // ---------------------------------------------------------------------------

    #[test]
    fn should_notify_returns_true_when_key_absent() {
        let r = make_reminder("rem-010", "2026-07-04T10:00:00Z");
        let set = HashSet::new();
        assert!(should_notify(&r, &set));
    }

    #[test]
    fn should_notify_returns_false_when_key_present() {
        let r = make_reminder("rem-011", "2026-07-04T10:00:00Z");
        let mut set = HashSet::new();
        set.insert(dedup_key(&r));
        assert!(!should_notify(&r, &set));
    }

    #[test]
    fn should_notify_fires_new_occurrence_after_snooze() {
        let fired_key = "rem-012|2026-07-04T10:00:00Z".to_string();
        let mut set = HashSet::new();
        set.insert(fired_key);

        // Same id, but snoozed_until gives a new occurrence key.
        let r_new = make_snoozed_reminder(
            "rem-012",
            "2026-07-04T10:00:00Z",
            "2026-07-04T10:30:00Z",
        );
        // The snoozed occurrence has a different key — should notify.
        assert!(should_notify(&r_new, &set));
    }

    #[test]
    fn should_notify_does_not_double_fire_snoozed_occurrence() {
        let r = make_snoozed_reminder(
            "rem-013",
            "2026-07-04T10:00:00Z",
            "2026-07-04T10:30:00Z",
        );
        let mut set = HashSet::new();
        set.insert(dedup_key(&r)); // mark as already notified
        assert!(!should_notify(&r, &set));
    }

    // ---------------------------------------------------------------------------
    // is_at_or_before_now tests
    // ---------------------------------------------------------------------------

    #[test]
    fn past_time_is_at_or_before_now() {
        // A date clearly in the past.
        assert!(is_at_or_before_now("2020-01-01T00:00:00Z"));
    }

    #[test]
    fn future_time_is_not_at_or_before_now() {
        // A date clearly in the future.
        assert!(!is_at_or_before_now("2099-12-31T23:59:59Z"));
    }

    #[test]
    fn unparseable_time_returns_false() {
        assert!(!is_at_or_before_now("not-a-date"));
        assert!(!is_at_or_before_now(""));
    }

    // ---------------------------------------------------------------------------
    // De-dup cache in-memory pruning tests (no disk I/O — uses a raw HashSet)
    // ---------------------------------------------------------------------------

    #[test]
    fn cache_prune_removes_stale_entries() {
        // We can test the pruning logic directly using HashSet.retain.
        let mut cache: HashSet<String> = [
            "rem-001|2026-07-04T10:00:00Z",
            "rem-002|2026-07-04T11:00:00Z",
            "rem-003|2026-07-04T12:00:00Z",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        // Live keys only include rem-001 and rem-003 this cycle.
        let live: HashSet<String> = [
            "rem-001|2026-07-04T10:00:00Z",
            "rem-003|2026-07-04T12:00:00Z",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        cache.retain(|k| live.contains(k));

        assert_eq!(cache.len(), 2);
        assert!(cache.contains("rem-001|2026-07-04T10:00:00Z"));
        assert!(!cache.contains("rem-002|2026-07-04T11:00:00Z"));
        assert!(cache.contains("rem-003|2026-07-04T12:00:00Z"));
    }

    #[test]
    fn cache_prune_empty_live_set_clears_all() {
        let mut cache: HashSet<String> = ["rem-001|2026-07-04T10:00:00Z"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let live: HashSet<String> = HashSet::new();
        cache.retain(|k| live.contains(k));
        assert!(cache.is_empty());
    }
}
