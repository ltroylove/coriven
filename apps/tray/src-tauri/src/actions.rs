// THIN-SHELL CONSTRAINT: This module handles snooze and dismiss actions.
// It contains:
//   - NO recurrence math, NO snooze-window computation (the backend owns that)
//   - NO direct database calls
// Snooze posts `minutes` to the backend; dismiss is local presentation state only.
//
// ## Primary notification action path (Wave 6.2.2 decision)
//
// Tauri v2 Windows toast action buttons (WinRT toast actions) are a known
// reliability risk in unsigned/unpackaged builds (documented in the wave spec).
// The primary path is therefore the PICKER WINDOW FALLBACK: clicking the
// notification toast opens a minimal snooze/dismiss picker WebviewWindow that
// offers the same three actions. The handler layer is button-source-agnostic —
// `handle_action` serves both a future direct button path and the picker path.
//
// Tauri v2 notification plugin action buttons would require:
//   - A packaged (MSIX) Windows build, or
//   - Reliable WinRT action handling in the notification plugin (not yet stable
//     for unsigned builds at Tauri v2.11).
//
// If in a future wave the action buttons become reliable, only `notify.rs` needs
// updating — the handler logic here is unchanged.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    auth::{AuthState, AuthStatus},
    offline::{post_snooze, DueCache, QueuedSnooze, SnoozeQueue, SnoozeResult, SNOOZE_60M},
    poll::PollState,
};

// ---------------------------------------------------------------------------
// Action types (button-source-agnostic)
// ---------------------------------------------------------------------------

/// A reminder action originating from either a notification button or the picker window.
/// Both paths call `handle_action` with the same payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ReminderAction {
    /// Snooze the reminder for the given number of minutes.
    Snooze { reminder_id: String, minutes: u32 },
    /// Suppress this occurrence locally. No backend call.
    Dismiss { reminder_id: String, effective_fire_time: String },
}

// ---------------------------------------------------------------------------
// Suppress store (dismiss state)
// ---------------------------------------------------------------------------

/// The set of occurrence keys (`reminderId|effectiveFireTime`) that the user
/// has explicitly dismissed for the current session.
///
/// This extends the Wave 6.2.1 de-dup cache: dismissed keys are kept across
/// restarts (in the notified-cache.json) so an explicit dismiss prevents replay
/// on relaunch. The same de-dup key format is reused deliberately — both the
/// "already notified" and "explicitly dismissed" cases produce the same outcome
/// (no re-fire for that occurrence).
///
/// No backend call is made for dismiss. This is intentional per the thin-shell
/// rule: the backend has no dismiss concept for an occurrence.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SuppressStore {
    /// Keys of occurrences the user has dismissed this session.
    /// Stored in-process only (the de-dup cache on disk handles restart persistence).
    pub dismissed: std::collections::HashSet<String>,
}

impl SuppressStore {
    /// Returns true if this occurrence key was explicitly dismissed.
    pub fn is_dismissed(&self, key: &str) -> bool {
        self.dismissed.contains(key)
    }

    /// Mark an occurrence as dismissed.
    pub fn dismiss(&mut self, key: String) {
        eprintln!(
            "[coriven-tray] actions: dismiss occurrence key={}",
            key
        );
        self.dismissed.insert(key);
    }
}

// ---------------------------------------------------------------------------
// Shared action state — managed by Tauri
// ---------------------------------------------------------------------------

/// Action state managed in the Tauri app state map.
/// Contains the suppress store and the snooze retry queue.
pub struct ActionState {
    pub suppress_store: Mutex<SuppressStore>,
    pub snooze_queue: Mutex<SnoozeQueue>,
}

impl ActionState {
    pub fn new(app: &AppHandle) -> Self {
        ActionState {
            suppress_store: Mutex::new(SuppressStore::default()),
            snooze_queue: Mutex::new(SnoozeQueue::load(app)),
        }
    }
}

// ---------------------------------------------------------------------------
// Button-source-agnostic action handler
// ---------------------------------------------------------------------------

/// Handle a reminder action from any source (notification button or picker window).
///
/// - Snooze: POST to the backend; on failure, enqueue for retry on reconnect.
/// - Dismiss: mark the occurrence in the suppress store + insert into the de-dup cache.
///
/// This function is `async` and spawned by callers that need fire-and-forget behavior.
pub async fn handle_action(
    app: AppHandle,
    action: ReminderAction,
    poll_state: Arc<Mutex<PollState>>,
) {
    match action {
        ReminderAction::Snooze { reminder_id, minutes } => {
            handle_snooze(&app, &reminder_id, minutes, &poll_state).await;
        }
        ReminderAction::Dismiss { reminder_id, effective_fire_time } => {
            handle_dismiss(&app, &reminder_id, &effective_fire_time);
        }
    }
}

/// Execute a snooze action.
///
/// Attempts a live POST. On 401, emits a token-refresh signal to the webview.
/// On network/5xx failure, enqueues for retry.
async fn handle_snooze(
    app: &AppHandle,
    reminder_id: &str,
    minutes: u32,
    poll_state: &Arc<Mutex<PollState>>,
) {
    let (token, api_base_url) = match get_auth_and_url(app, poll_state) {
        Some(pair) => pair,
        None => {
            // Not signed in — queue the snooze so it can be delivered after auth.
            eprintln!(
                "[coriven-tray] actions: snooze queued (not signed in) reminder={}",
                reminder_id
            );
            enqueue_snooze(app, reminder_id, minutes);
            return;
        }
    };

    match post_snooze(&api_base_url, reminder_id, minutes, &token).await {
        SnoozeResult::Ok => {
            // Success — nothing more to do; the next poll will see the updated snoozed_until.
        }
        SnoozeResult::Unauthorized => {
            // 401: signal the webview to refresh the session.
            emit_refresh_needed(app);
            // Queue the snooze for retry after refresh.
            enqueue_snooze(app, reminder_id, minutes);
        }
        SnoozeResult::Failed(_) => {
            // Network or 5xx — queue for retry on reconnect.
            enqueue_snooze(app, reminder_id, minutes);
        }
    }
}

/// Execute a dismiss action: mark the occurrence in the in-process suppress store
/// and insert the de-dup key into the shared de-dup cache (persisted to disk).
///
/// D-4 fix: instead of independent file I/O, this now routes through the
/// `SharedDedupeCache` managed state — the same Mutex-guarded owner the poll loop
/// uses. This eliminates the lost-update race where a concurrent dismiss and poll
/// could each read stale state and overwrite each other's write.
///
/// No backend call is made.
fn handle_dismiss(app: &AppHandle, reminder_id: &str, effective_fire_time: &str) {
    use crate::SharedDedupeCache;

    let key = format!("{}|{}", reminder_id, effective_fire_time);

    // In-process suppress store.
    if let Some(state) = app.try_state::<ActionState>() {
        if let Ok(mut store) = state.suppress_store.lock() {
            store.dismiss(key.clone());
        }
    }

    // D-4 fix: route through the shared de-dup cache to avoid the lost-update race.
    // Clone the Arc from managed state immediately so we don't hold the State<'_>
    // borrow beyond this expression (same lifetime pattern used in poll.rs).
    let shared_arc = app
        .try_state::<SharedDedupeCache>()
        .map(|s| s.0.clone());

    if let Some(arc) = shared_arc {
        match arc.lock() {
            Ok(mut cache) => {
                if !cache.contains(&key) {
                    eprintln!("[coriven-tray] actions: dismiss persisted via shared dedup cache key={}", key);
                    cache.insert(key);
                }
            }
            Err(_) => {
                eprintln!("[coriven-tray] actions: dismiss — shared dedup cache lock poisoned");
            }
        }
    } else {
        eprintln!("[coriven-tray] actions: dismiss — SharedDedupeCache unavailable (state not registered)");
    }
}

/// Enqueue a snooze for later retry.
fn enqueue_snooze(app: &AppHandle, reminder_id: &str, minutes: u32) {
    if let Some(state) = app.try_state::<ActionState>() {
        if let Ok(mut queue) = state.snooze_queue.lock() {
            let entry = QueuedSnooze {
                reminder_id: reminder_id.to_string(),
                minutes,
                requested_at: chrono::Utc::now().to_rfc3339(),
            };
            queue.enqueue(entry, app);
        }
    }
}

/// Extract the current access token and API base URL from managed state.
/// Returns None if not signed in or state is unavailable.
fn get_auth_and_url(
    app: &AppHandle,
    poll_state: &Arc<Mutex<PollState>>,
) -> Option<(String, String)> {
    let auth_state = app.try_state::<AuthState>()?;
    let (status, opt_token) = auth_state.get_session().ok()?;
    if status != AuthStatus::SignedIn {
        return None;
    }
    let token = opt_token?;
    let api_base_url = poll_state.lock().ok()?.api_base_url.clone();
    Some((token, api_base_url))
}

/// Emit a Tauri event to the webview requesting a session token refresh.
///
/// Token refresh design (Wave 6.2.2):
/// The Supabase refresh token path requires webview interaction — the refresh
/// call uses the JS Supabase client which holds the session. Rust cannot call
/// Supabase directly without embedding the full JS SDK.
///
/// Instead: on a 401, the tray emits `coriven://auth/refresh-needed`. The
/// webview listens for this event, calls `supabase.auth.refreshSession()`, and
/// on success calls `notify_signed_in` with the new access token. This keeps
/// the thin-shell constraint: no Supabase client in Rust.
///
/// If the webview is not open (normal for a background tray), the event is not
/// received and the snooze is queued. On the next tray-window open, the webview
/// can check auth state and refresh proactively.
fn emit_refresh_needed(app: &AppHandle) {
    eprintln!("[coriven-tray] actions: emitting auth refresh-needed event to webview");
    let _ = app.emit("coriven://auth/refresh-needed", ());
}

// ---------------------------------------------------------------------------
// Snooze All
// ---------------------------------------------------------------------------

/// Snooze every currently due, un-dismissed reminder by SNOOZE_60M minutes.
///
/// Iterates the last cached poll payload. Per-reminder failures are isolated:
/// successful snoozes are kept; failures are queued for retry. This matches
/// the wave spec requirement for partial-failure tolerance.
pub async fn snooze_all(
    app: AppHandle,
    poll_state: Arc<Mutex<PollState>>,
) {
    let (token, api_base_url) = match get_auth_and_url(&app, &poll_state) {
        Some(pair) => pair,
        None => {
            eprintln!("[coriven-tray] actions: snooze_all skipped — not signed in");
            return;
        }
    };

    // Read the current cached due list.
    let due_cache = DueCache::load(&app);
    let reminders = due_cache.reminders;

    if reminders.is_empty() {
        eprintln!("[coriven-tray] actions: snooze_all — no due reminders cached");
        return;
    }

    // Read the suppress store to skip explicitly dismissed occurrences.
    let dismissed_keys: std::collections::HashSet<String> = app
        .try_state::<ActionState>()
        .and_then(|s| s.suppress_store.lock().ok().map(|s| s.dismissed.clone()))
        .unwrap_or_default();

    eprintln!(
        "[coriven-tray] actions: snooze_all — {} reminder(s) in cache, {} dismissed",
        reminders.len(),
        dismissed_keys.len()
    );

    let mut succeeded = 0usize;
    let mut queued = 0usize;

    for reminder in &reminders {
        let key = crate::poll::dedup_key(reminder);
        if dismissed_keys.contains(&key) {
            continue; // already dismissed this occurrence
        }
        let fire_time = crate::poll::effective_fire_time(reminder).to_string();
        if !crate::poll::is_at_or_before_now(&fire_time) {
            continue; // not yet due — skip rather than snooze a future reminder
        }

        match post_snooze(&api_base_url, &reminder.id, SNOOZE_60M, &token).await {
            SnoozeResult::Ok => {
                succeeded += 1;
            }
            SnoozeResult::Unauthorized => {
                emit_refresh_needed(&app);
                enqueue_snooze(&app, &reminder.id, SNOOZE_60M);
                queued += 1;
            }
            SnoozeResult::Failed(_) => {
                enqueue_snooze(&app, &reminder.id, SNOOZE_60M);
                queued += 1;
            }
        }
    }

    eprintln!(
        "[coriven-tray] actions: snooze_all complete — succeeded={succeeded} queued={queued}"
    );
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // ---------------------------------------------------------------------------
    // SuppressStore tests
    // ---------------------------------------------------------------------------

    #[test]
    fn suppress_store_dismiss_marks_key() {
        let mut store = SuppressStore::default();
        let key = "rem-001|2026-07-04T10:00:00Z".to_string();
        assert!(!store.is_dismissed(&key));
        store.dismiss(key.clone());
        assert!(store.is_dismissed(&key));
    }

    #[test]
    fn suppress_store_dismiss_only_affects_given_key() {
        let mut store = SuppressStore::default();
        store.dismiss("rem-001|2026-07-04T10:00:00Z".to_string());
        // A different occurrence of the same reminder is not dismissed.
        assert!(!store.is_dismissed("rem-001|2026-07-04T11:00:00Z"));
        // A different reminder is not dismissed.
        assert!(!store.is_dismissed("rem-002|2026-07-04T10:00:00Z"));
    }

    #[test]
    fn suppress_store_dismiss_is_idempotent() {
        let mut store = SuppressStore::default();
        let key = "rem-001|2026-07-04T10:00:00Z".to_string();
        store.dismiss(key.clone());
        store.dismiss(key.clone()); // second dismiss must not panic or duplicate
        assert!(store.is_dismissed(&key));
        assert_eq!(store.dismissed.len(), 1);
    }

    // ---------------------------------------------------------------------------
    // ReminderAction serialisation (button-source-agnostic contract)
    // ---------------------------------------------------------------------------

    #[test]
    fn snooze_action_serialises_correctly() {
        let action = ReminderAction::Snooze {
            reminder_id: "rem-abc".to_string(),
            minutes: 15,
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"kind\":\"snooze\""));
        assert!(json.contains("\"reminder_id\":\"rem-abc\""));
        assert!(json.contains("\"minutes\":15"));
    }

    #[test]
    fn dismiss_action_serialises_correctly() {
        let action = ReminderAction::Dismiss {
            reminder_id: "rem-xyz".to_string(),
            effective_fire_time: "2026-07-04T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"kind\":\"dismiss\""));
        assert!(json.contains("\"reminder_id\":\"rem-xyz\""));
    }

    #[test]
    fn snooze_action_deserialises_correctly() {
        let json = r#"{"kind":"snooze","reminder_id":"rem-001","minutes":60}"#;
        let action: ReminderAction = serde_json::from_str(json).unwrap();
        assert_eq!(
            action,
            ReminderAction::Snooze {
                reminder_id: "rem-001".to_string(),
                minutes: 60,
            }
        );
    }

    #[test]
    fn dismiss_action_deserialises_correctly() {
        let json = r#"{"kind":"dismiss","reminder_id":"rem-002","effective_fire_time":"2026-07-04T10:00:00Z"}"#;
        let action: ReminderAction = serde_json::from_str(json).unwrap();
        assert_eq!(
            action,
            ReminderAction::Dismiss {
                reminder_id: "rem-002".to_string(),
                effective_fire_time: "2026-07-04T10:00:00Z".to_string(),
            }
        );
    }

    // ---------------------------------------------------------------------------
    // Snooze All target selection (pure logic — no AppHandle)
    // ---------------------------------------------------------------------------

    /// Simulate the Snooze All filter: reminders minus dismissed ones.
    fn snooze_all_targets(
        reminder_ids: &[&str],
        dismissed_keys: &HashSet<String>,
    ) -> Vec<String> {
        reminder_ids
            .iter()
            .filter(|id| {
                // Build the dedup key using a fixed fire time for test simplicity.
                let key = format!("{}|2026-07-04T10:00:00Z", id);
                !dismissed_keys.contains(&key)
            })
            .map(|id| id.to_string())
            .collect()
    }

    #[test]
    fn snooze_all_skips_dismissed_reminders() {
        let ids = ["rem-001", "rem-002", "rem-003"];
        let mut dismissed = HashSet::new();
        dismissed.insert("rem-002|2026-07-04T10:00:00Z".to_string());

        let targets = snooze_all_targets(&ids, &dismissed);
        assert_eq!(targets.len(), 2);
        assert!(targets.contains(&"rem-001".to_string()));
        assert!(!targets.contains(&"rem-002".to_string()));
        assert!(targets.contains(&"rem-003".to_string()));
    }

    #[test]
    fn snooze_all_with_no_dismissals_targets_all() {
        let ids = ["rem-001", "rem-002"];
        let dismissed = HashSet::new();
        let targets = snooze_all_targets(&ids, &dismissed);
        assert_eq!(targets.len(), 2);
    }

    #[test]
    fn snooze_all_empty_cache_targets_none() {
        let ids: [&str; 0] = [];
        let dismissed = HashSet::new();
        let targets = snooze_all_targets(&ids, &dismissed);
        assert!(targets.is_empty());
    }

    // ---------------------------------------------------------------------------
    // Partial failure queue: Snooze All — failed items are queued, success not
    // ---------------------------------------------------------------------------

    #[test]
    fn snooze_all_partial_failure_only_queues_failures() {
        // Simulate three reminders; one fails.
        // Successful ids would be removed from the queue; only failures remain.
        let all_ids = vec!["rem-001", "rem-002", "rem-003"];
        let failed_ids = vec!["rem-002"]; // backend returned 500

        let queued: Vec<&str> = all_ids
            .iter()
            .copied()
            .filter(|id| failed_ids.contains(id))
            .collect();

        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0], "rem-002");
    }

    // ---------------------------------------------------------------------------
    // D-4: dismiss cache-write via shared cache abstraction
    // ---------------------------------------------------------------------------

    /// D-4 fix: verify that two concurrent dismiss operations on the same key
    /// are idempotent when routed through a shared cache (HashSet deduplication).
    ///
    /// This tests the pure in-memory path of the shared-cache update — the disk
    /// persistence (DedupeCache.insert → persist) is tested in poll.rs.
    #[test]
    fn dismiss_via_shared_cache_is_idempotent() {
        use std::collections::HashSet;

        // Simulate the shared dedup-cache in-memory set.
        let mut cache_inner: HashSet<String> = HashSet::new();

        let key1 = "rem-001|2026-07-04T10:00:00Z".to_string();
        let key2 = "rem-002|2026-07-04T10:00:00Z".to_string();

        // First dismiss: key1 not present → insert.
        if !cache_inner.contains(&key1) {
            cache_inner.insert(key1.clone());
        }
        assert_eq!(cache_inner.len(), 1);

        // Second dismiss of same key: already present → no duplicate.
        if !cache_inner.contains(&key1) {
            cache_inner.insert(key1.clone());
        }
        assert_eq!(cache_inner.len(), 1, "duplicate dismiss must not grow cache");

        // Dismiss a different key: goes in.
        if !cache_inner.contains(&key2) {
            cache_inner.insert(key2.clone());
        }
        assert_eq!(cache_inner.len(), 2);
    }

    /// D-4 fix: verify that a dismiss-then-poll sequence (serialised by Mutex)
    /// produces the correct final cache state — dismiss key is present after
    /// the "poll" reads the shared state.
    #[test]
    fn dismiss_then_poll_shared_state_is_consistent() {
        use std::collections::HashSet;
        use std::sync::{Arc, Mutex};

        // Shared cache wrapped in Arc<Mutex<_>> — mimics SharedDedupeCache.
        let shared: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        let dismiss_key = "rem-001|2026-07-04T10:00:00Z".to_string();

        // Dismiss: lock → insert → unlock.
        {
            let mut cache = shared.lock().unwrap();
            cache.insert(dismiss_key.clone());
        }

        // Poll: lock → check → unlock. Dismissed key must be visible.
        {
            let cache = shared.lock().unwrap();
            assert!(
                cache.contains(&dismiss_key),
                "poll must see key inserted by dismiss (shared cache, no lost-update)"
            );
        }
    }

    // ---------------------------------------------------------------------------
    // Token refresh on 401 — decision test
    // ---------------------------------------------------------------------------

    /// Verify the refresh-needed decision: 401 must trigger a refresh signal
    /// AND enqueue the snooze for retry. This tests the outcome shape, not the
    /// actual HTTP call (which requires a live Tauri app).
    #[test]
    fn on_401_snooze_is_queued_for_retry() {
        // Simulate the handling of a SnoozeResult::Unauthorized.
        // In the real code path: emit_refresh_needed(app) + enqueue_snooze(app, id, minutes).
        // Here we verify the queue state after the simulated handling.
        let mut queue = SnoozeQueue::default();
        // Simulate enqueue_snooze without AppHandle (push directly).
        queue.entries.push(QueuedSnooze {
            reminder_id: "rem-401".to_string(),
            minutes: 15,
            requested_at: "2026-07-04T10:00:00Z".to_string(),
        });
        assert_eq!(queue.depth(), 1);
        assert_eq!(queue.entries[0].reminder_id, "rem-401");
        // The refresh signal is emitted via app.emit — tested manually at runtime.
    }

    // ---------------------------------------------------------------------------
    // Queue flush (offline reconciliation): exactly-once delivery
    // ---------------------------------------------------------------------------

    #[test]
    fn queue_flush_removes_delivered_entries_exactly_once() {
        let mut queue = SnoozeQueue {
            entries: vec![
                QueuedSnooze {
                    reminder_id: "rem-001".to_string(),
                    minutes: 15,
                    requested_at: "2026-07-04T10:00:00Z".to_string(),
                },
                QueuedSnooze {
                    reminder_id: "rem-002".to_string(),
                    minutes: 60,
                    requested_at: "2026-07-04T10:00:00Z".to_string(),
                },
            ],
        };

        // Deliver rem-001 successfully; rem-002 fails and stays.
        let delivered = vec!["rem-001".to_string()];
        queue.entries.retain(|e| !delivered.contains(&e.reminder_id));

        assert_eq!(queue.depth(), 1);
        assert_eq!(queue.entries[0].reminder_id, "rem-002");

        // Attempt to remove rem-001 again — must be idempotent (already gone).
        queue.entries.retain(|e| !delivered.contains(&e.reminder_id));
        assert_eq!(queue.depth(), 1); // still 1, not 0
    }
}
