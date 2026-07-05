// THIN-SHELL CONSTRAINT: This module is the ONLY place where a native notification
// is dispatched. It wraps the Tauri v2 notification plugin behind a typed seam so
// that Wave 6.2.2 can attach action buttons without touching the poll loop.
//
// Wave 6.2.1 scope: plain title + body toasts only. No action buttons.
// Wave 6.2.2 will extend `NotificationMeta` and call the action-button API here.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Carry-forward metadata threaded through the notification seam.
/// Wave 6.2.1: populated but not yet used for actions (Wave 6.2.2 will add them).
#[derive(Debug, Clone)]
pub struct NotificationMeta {
    /// The `task_reminders` row id — used by Wave 6.2.2 to route snooze/dismiss actions.
    pub reminder_id: String,
    /// The effective fire time ISO-8601 string (the occurrence key).
    pub effective_fire_time: String,
}

/// Dispatch one native Windows toast for a due reminder.
///
/// # Parameters
/// - `app`: live Tauri app handle
/// - `title`: reminder headline (task title from the API)
/// - `body`: human-readable body (the formatted effective fire time)
/// - `meta`: reminder id + occurrence, reserved for Wave 6.2.2 action buttons
///
/// # Errors
/// Returns an `Err` string on plugin failure. The caller logs and continues —
/// a single failed toast must never stop the poll loop.
///
/// # Security
/// No tokens or reminder content beyond `title` and `body` are included in any log.
pub fn dispatch_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    _meta: &NotificationMeta,
) -> Result<(), String> {
    // SECURITY: Only title/body go to the OS — _meta is reserved for Wave 6.2.2.
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification dispatch failed: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// Note: dispatch_notification requires a live Tauri AppHandle and cannot be
// unit-tested without a running Tauri context. Integration/manual verification
// covers the toast path. This module's tests verify the meta shape only.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_meta_carries_required_fields() {
        let meta = NotificationMeta {
            reminder_id: "rem-abc".to_string(),
            effective_fire_time: "2026-07-04T10:00:00Z".to_string(),
        };
        assert_eq!(meta.reminder_id, "rem-abc");
        assert_eq!(meta.effective_fire_time, "2026-07-04T10:00:00Z");
    }

    #[test]
    fn notification_meta_is_clone() {
        let meta = NotificationMeta {
            reminder_id: "rem-xyz".to_string(),
            effective_fire_time: "2026-07-04T12:00:00Z".to_string(),
        };
        let cloned = meta.clone();
        assert_eq!(cloned.reminder_id, meta.reminder_id);
        assert_eq!(cloned.effective_fire_time, meta.effective_fire_time);
    }
}
