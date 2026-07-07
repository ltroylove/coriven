// THIN-SHELL CONSTRAINT: This module manages the local offline cache and snooze
// retry queue. It contains:
//   - NO database client
//   - NO recurrence computation
//   - NO snooze semantics (minutes are caller-supplied from the API contract)
// The backend owns all durability; this module only buffers calls that could not
// reach the backend due to network conditions.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::poll::DueReminder;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Snooze durations in minutes — action constants match the backend contract.
pub const SNOOZE_15M: u32 = 15;
pub const SNOOZE_60M: u32 = 60;

// ---------------------------------------------------------------------------
// Offline due-payload cache
// ---------------------------------------------------------------------------

/// The last successfully fetched due-reminder payload, persisted to disk.
///
/// On poll failure (network/offline) the fire-decision loop runs against this
/// cached list instead of returning early. The cache is replaced atomically on
/// every successful poll.
///
/// NO tokens or sensitive data are stored here — only reminder ids, timestamps,
/// and task titles (same data the OS receives as a toast notification).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DueCache {
    /// The cached reminder list (empty before the first successful poll).
    pub reminders: Vec<DueReminder>,
    /// ISO-8601 timestamp of when this cache was last refreshed.
    pub fetched_at: Option<String>,
    /// True when the last poll attempt failed — activates cached-data mode.
    pub is_offline: bool,
}

impl DueCache {
    /// Load the cache from the app-data directory, or return a blank default.
    pub fn load(app: &AppHandle) -> Self {
        let path = due_cache_path(app);
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => DueCache::default(),
        }
    }

    /// Persist the cache to disk. Failures are logged but not fatal.
    pub fn save(&self, app: &AppHandle) {
        let path = due_cache_path(app);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match serde_json::to_string(self) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&path, json) {
                    eprintln!("[coriven-tray] offline: failed to persist due-cache: {e}");
                }
            }
            Err(e) => {
                eprintln!("[coriven-tray] offline: failed to serialize due-cache: {e}");
            }
        }
    }

    /// Replace the cached payload with a fresh poll result.
    /// Called on every successful poll; resets offline mode.
    pub fn update_from_poll(&mut self, reminders: Vec<DueReminder>, app: &AppHandle) {
        let was_offline = self.is_offline;
        self.reminders = reminders;
        self.fetched_at = Some(chrono::Utc::now().to_rfc3339());
        self.is_offline = false;
        if was_offline {
            eprintln!("[coriven-tray] offline: reconnected — cache refreshed from live poll");
        }
        self.save(app);
    }

    /// Mark the cache as operating in offline mode.
    /// Called when a poll fails; the cached reminder list is unchanged.
    pub fn mark_offline(&mut self, app: &AppHandle) {
        if !self.is_offline {
            eprintln!(
                "[coriven-tray] offline: poll failed — entering cached-data mode ({} reminder(s) cached)",
                self.reminders.len()
            );
            self.is_offline = true;
            self.save(app);
        }
    }
}

fn due_cache_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("due-cache.json")
}

// ---------------------------------------------------------------------------
// Snooze retry queue
// ---------------------------------------------------------------------------

/// A single queued snooze action that could not be delivered to the backend.
///
/// Entries are deleted from the queue only on a confirmed 2xx response.
/// On reconnect the queue is drained FIFO; duplicate delivery is tolerated
/// (the backend's update is effectively idempotent for equal-duration snoozes
/// on the same reminder, producing an equal or later snoozed_until value).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedSnooze {
    /// The `task_reminders` row id (the reminder to snooze).
    pub reminder_id: String,
    /// Duration in minutes to pass to `POST /api/tasks/{id}/snooze`.
    pub minutes: u32,
    /// ISO-8601 timestamp when the action was originally requested (for logging).
    pub requested_at: String,
}

/// Durable snooze retry queue.
///
/// Persisted to the app-data directory so that snoozes queued offline survive
/// a tray restart. Drained FIFO on the next successful API contact.
///
/// NO tokens are stored here.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SnoozeQueue {
    pub entries: Vec<QueuedSnooze>,
}

impl SnoozeQueue {
    /// Load the queue from disk, or start empty if absent/malformed.
    pub fn load(app: &AppHandle) -> Self {
        let path = queue_path(app);
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => SnoozeQueue::default(),
        }
    }

    /// Append a new entry to the queue and persist it.
    pub fn enqueue(&mut self, entry: QueuedSnooze, app: &AppHandle) {
        eprintln!(
            "[coriven-tray] offline: queued snooze for reminder={} minutes={}",
            entry.reminder_id, entry.minutes
        );
        self.entries.push(entry);
        self.save(app);
    }

    /// Remove all entries whose reminder_id is in `delivered`.
    /// Called after a successful flush to remove confirmed deliveries.
    pub fn remove_delivered(&mut self, delivered: &[String], app: &AppHandle) {
        let before = self.entries.len();
        self.entries
            .retain(|e| !delivered.contains(&e.reminder_id));
        let removed = before - self.entries.len();
        if removed > 0 {
            eprintln!(
                "[coriven-tray] offline: queue flushed {removed} delivered snooze(s); {} remain",
                self.entries.len()
            );
            self.save(app);
        }
    }

    /// Return the current queue depth (for tray menu indicator and tests).
    pub fn depth(&self) -> usize {
        self.entries.len()
    }

    fn save(&self, app: &AppHandle) {
        let path = queue_path(app);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match serde_json::to_string(self) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&path, json) {
                    eprintln!("[coriven-tray] offline: failed to persist snooze queue: {e}");
                }
            }
            Err(e) => {
                eprintln!("[coriven-tray] offline: failed to serialize snooze queue: {e}");
            }
        }
    }
}

fn queue_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("snooze-queue.json")
}

// ---------------------------------------------------------------------------
// Snooze HTTP helper (used by both the action handler and Snooze All)
// ---------------------------------------------------------------------------

/// Result of a single snooze attempt.
#[derive(Debug)]
pub enum SnoozeResult {
    /// Backend accepted the snooze (2xx).
    Ok,
    /// 401 — session expired; tray should signal a refresh.
    Unauthorized,
    /// Network or non-401 HTTP error — enqueue for retry.
    Failed(String),
}

/// POST `{api_base_url}/api/tasks/{reminder_id}/snooze` with `{ minutes }`.
///
/// Returns `SnoozeResult::Ok` on 2xx, `SnoozeResult::Unauthorized` on 401,
/// or `SnoozeResult::Failed` on any other error (network or non-2xx/401 HTTP).
///
/// SECURITY: The access token is in the Authorization header only — never logged.
pub async fn post_snooze(
    api_base_url: &str,
    reminder_id: &str,
    minutes: u32,
    access_token: &str,
) -> SnoozeResult {
    let url = format!("{}/api/tasks/{}/snooze", api_base_url, reminder_id);
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "minutes": minutes });

    match client
        .post(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                eprintln!(
                    "[coriven-tray] actions: snooze 401 — token expired for reminder={}",
                    reminder_id
                );
                SnoozeResult::Unauthorized
            } else if status.is_success() {
                eprintln!(
                    "[coriven-tray] actions: snooze confirmed by backend reminder={} minutes={}",
                    reminder_id, minutes
                );
                SnoozeResult::Ok
            } else {
                eprintln!(
                    "[coriven-tray] actions: snooze http {} for reminder={}",
                    status.as_u16(),
                    reminder_id
                );
                SnoozeResult::Failed(format!("http {}", status.as_u16()))
            }
        }
        Err(e) => {
            eprintln!(
                "[coriven-tray] actions: snooze network error for reminder={}: {}",
                reminder_id, e
            );
            SnoozeResult::Failed(format!("network: {e}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------------
    // DueCache tests (in-memory only — no AppHandle needed for logic)
    // ---------------------------------------------------------------------------

    #[test]
    fn due_cache_default_is_not_offline() {
        let cache = DueCache::default();
        assert!(!cache.is_offline);
        assert!(cache.reminders.is_empty());
        assert!(cache.fetched_at.is_none());
    }

    #[test]
    fn due_cache_serialises_and_deserialises() {
        let cache = DueCache {
            reminders: vec![],
            fetched_at: Some("2026-07-04T10:00:00Z".to_string()),
            is_offline: true,
        };
        let json = serde_json::to_string(&cache).unwrap();
        let decoded: DueCache = serde_json::from_str(&json).unwrap();
        assert!(decoded.is_offline);
        assert_eq!(decoded.fetched_at.as_deref(), Some("2026-07-04T10:00:00Z"));
    }

    // ---------------------------------------------------------------------------
    // SnoozeQueue tests (pure — no AppHandle or disk I/O)
    // ---------------------------------------------------------------------------

    fn make_entry(id: &str, minutes: u32) -> QueuedSnooze {
        QueuedSnooze {
            reminder_id: id.to_string(),
            minutes,
            requested_at: "2026-07-04T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn queue_default_is_empty() {
        let q = SnoozeQueue::default();
        assert_eq!(q.depth(), 0);
        assert!(q.entries.is_empty());
    }

    #[test]
    fn queue_enqueue_increases_depth() {
        let mut q = SnoozeQueue::default();
        // Directly push without AppHandle (unit test — no disk I/O)
        q.entries.push(make_entry("rem-001", 15));
        assert_eq!(q.depth(), 1);
        q.entries.push(make_entry("rem-002", 60));
        assert_eq!(q.depth(), 2);
    }

    #[test]
    fn queue_remove_delivered_removes_only_matching() {
        let mut q = SnoozeQueue {
            entries: vec![
                make_entry("rem-001", 15),
                make_entry("rem-002", 60),
                make_entry("rem-003", 15),
            ],
        };
        // Simulate delivering rem-001 and rem-003 (rem-002 failed)
        let delivered = vec!["rem-001".to_string(), "rem-003".to_string()];
        q.entries.retain(|e| !delivered.contains(&e.reminder_id));
        assert_eq!(q.depth(), 1);
        assert_eq!(q.entries[0].reminder_id, "rem-002");
    }

    #[test]
    fn queue_remove_delivered_empty_list_is_noop() {
        let mut q = SnoozeQueue {
            entries: vec![make_entry("rem-001", 15)],
        };
        let delivered: Vec<String> = vec![];
        q.entries.retain(|e| !delivered.contains(&e.reminder_id));
        assert_eq!(q.depth(), 1);
    }

    #[test]
    fn queue_serialises_and_deserialises() {
        let q = SnoozeQueue {
            entries: vec![
                make_entry("rem-aaa", 15),
                make_entry("rem-bbb", 60),
            ],
        };
        let json = serde_json::to_string(&q).unwrap();
        let decoded: SnoozeQueue = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.depth(), 2);
        assert_eq!(decoded.entries[0].reminder_id, "rem-aaa");
        assert_eq!(decoded.entries[0].minutes, 15);
        assert_eq!(decoded.entries[1].reminder_id, "rem-bbb");
        assert_eq!(decoded.entries[1].minutes, 60);
    }

    // ---------------------------------------------------------------------------
    // Offline constants
    // ---------------------------------------------------------------------------

    #[test]
    fn snooze_duration_constants_are_correct() {
        assert_eq!(SNOOZE_15M, 15);
        assert_eq!(SNOOZE_60M, 60);
    }
}
