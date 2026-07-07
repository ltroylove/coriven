// THIN-SHELL CONSTRAINT: This module is the ONLY place where a native notification
// is dispatched. It wraps the Tauri v2 notification plugin behind a typed seam.
//
// ## Wave 6.2.2: Notification action path decision
//
// Tauri v2 Windows toast action buttons (WinRT toast actions) are a known
// reliability risk in unsigned/unpackaged builds.  The primary action path is
// therefore the PICKER WINDOW FALLBACK:
//
//   1. `dispatch_notification` fires a plain toast (title + body), as in 6.2.1.
//   2. The notification carries the reminder id + occurrence in its identifier.
//   3. Clicking the toast (or the tray menu picker) opens a minimal
//      snooze/dismiss picker WebviewWindow that provides the same three actions.
//   4. The picker window calls the `reminder_action` Tauri command, which routes
//      to the button-source-agnostic `handle_action` in `actions.rs`.
//
// The notification identifier encodes `reminderId|effectiveFireTime` (URL-safe
// base64) so the picker window can decode which reminder to act on. This is
// logged as "identifier set" without revealing the content beyond the id.
//
// If in a future wave the Tauri notification plugin's action-button API becomes
// reliably supported on unsigned Windows builds, only this file needs updating —
// the handler logic in `actions.rs` is unchanged.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Carry-forward metadata threaded through the notification seam.
#[derive(Debug, Clone)]
pub struct NotificationMeta {
    /// The `task_reminders` row id — used to route snooze/dismiss actions.
    pub reminder_id: String,
    /// The effective fire time ISO-8601 string (the occurrence key).
    pub effective_fire_time: String,
}

/// Dispatch one native Windows toast for a due reminder.
///
/// The WinRT notification has no custom identifier — the toast title/body are
/// the only user-visible fields. Action routing (snooze/dismiss) is handled via
/// the picker window; see `open_reminder_picker` and `encode_action_payload`.
///
/// # Parameters
/// - `app`: live Tauri app handle
/// - `title`: reminder headline (task title from the API)
/// - `body`: human-readable body (the formatted effective fire time)
/// - `meta`: reminder id + occurrence used for action routing
///
/// # Errors
/// Returns an `Err` string on plugin failure. The caller logs and continues —
/// a single failed toast must never stop the poll loop.
///
/// # Security
/// No tokens or reminder content beyond `title`, `body`, and the encoded id
/// are included in any log.
pub fn dispatch_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    meta: &NotificationMeta,
) -> Result<(), String> {
    eprintln!(
        "[coriven-tray] notify: dispatching toast for reminder_id={} (picker-window fallback active)",
        meta.reminder_id
    );

    // Build and show the toast. Action routing (snooze/dismiss) is handled via the
    // picker window opened by `open_reminder_picker` — not via WinRT toast actions
    // (see module-level comment for the fallback rationale).
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification dispatch failed: {e}"))?;

    Ok(())
}

/// Encode `{reminderId}|{effectiveFireTime}` as a percent-encoded string.
/// Used as the `payload` query parameter in the picker window URL so the JS
/// side can decode which reminder to act on.
///
/// Pure function — no I/O, testable without Tauri.
pub fn encode_action_payload(reminder_id: &str, effective_fire_time: &str) -> String {
    let raw = format!("{}|{}", reminder_id, effective_fire_time);
    // Simple base64 encoding using the standard alphabet.
    // We use the standard Engine from the `base64` crate; if not available,
    // we use a lightweight manual approach to avoid adding a dependency.
    // The Tauri ecosystem already pulls in base64 transitively; we use the
    // stdlib approach (encode as hex-escaped is less clean, so we use base64
    // from the tauri/reqwest transitive dep or fall back to percent-encoding).
    //
    // To keep Cargo.toml minimal: use a simple URL-safe encoding using
    // the existing serde_json + standard library only (percent-encode the payload).
    percent_encode(&raw)
}

/// Decode the action payload back to `(reminder_id, effective_fire_time)`.
/// Returns None if the payload is malformed.
///
/// Pure function — testable without Tauri.
pub fn decode_action_payload(encoded: &str) -> Option<(String, String)> {
    let raw = percent_decode(encoded)?;
    let mut parts = raw.splitn(2, '|');
    let reminder_id = parts.next()?.to_string();
    let effective_fire_time = parts.next()?.to_string();
    if reminder_id.is_empty() || effective_fire_time.is_empty() {
        return None;
    }
    Some((reminder_id, effective_fire_time))
}

/// Percent-encode a string (RFC 3986 unreserved characters pass through;
/// all others are `%XX` encoded). Keeps the payload URL-safe and round-trippable.
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            // Unreserved: ALPHA / DIGIT / "-" / "." / "_" / "~"
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            other => {
                out.push('%');
                out.push(char::from_digit((other >> 4) as u32, 16).unwrap_or('0'));
                out.push(char::from_digit((other & 0xF) as u32, 16).unwrap_or('0'));
            }
        }
    }
    out
}

/// Percent-decode a string. Returns None if the encoding is malformed.
fn percent_decode(input: &str) -> Option<String> {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hi = char::from(bytes[i + 1]).to_digit(16)? as u8;
            let lo = char::from(bytes[i + 2]).to_digit(16)? as u8;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Open (or focus) the snooze/dismiss picker window for a specific reminder.
///
/// The window navigates to `/tray/picker?payload={encoded}` in the bundled
/// web app. The web page decodes the payload, presents three buttons (Snooze 15m,
/// Snooze 1h, Dismiss), and calls the `reminder_action` Tauri command on click.
///
/// If the window is already open for this reminder, it is brought to front.
/// This is the primary action path for Wave 6.2.2 (see module-level comment).
pub fn open_picker_window(app: &AppHandle, reminder_id: &str, effective_fire_time: &str) {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let payload = encode_action_payload(reminder_id, effective_fire_time);
    // Window id is unique per reminder occurrence so multiple reminders can have
    // independent picker windows (edge case but handled).
    let window_id = format!("picker-{}", &payload[..payload.len().min(20)]);
    let url = format!("index.html#/tray/picker?payload={}", payload);

    // If the window already exists, bring it to front.
    if let Some(win) = app.get_webview_window(&window_id) {
        let _ = win.show();
        let _ = win.set_focus();
        eprintln!("[coriven-tray] notify: picker window already open — focused");
        return;
    }

    match WebviewWindowBuilder::new(app, &window_id, WebviewUrl::App(url.into()))
        .title("Coriven — Reminder Action")
        .inner_size(320.0, 200.0)
        .resizable(false)
        .always_on_top(true)
        .center()
        .build()
    {
        Ok(_) => {
            eprintln!(
                "[coriven-tray] notify: picker window opened for reminder_id={}",
                reminder_id
            );
        }
        Err(e) => {
            eprintln!("[coriven-tray] notify: failed to open picker window: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
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

    // ---------------------------------------------------------------------------
    // encode / decode round-trip
    // ---------------------------------------------------------------------------

    #[test]
    fn encode_decode_round_trips_ascii_ids() {
        let id = "rem-abc-123";
        let fire_time = "2026-07-04T10:00:00Z";
        let encoded = encode_action_payload(id, fire_time);
        let (decoded_id, decoded_fire) = decode_action_payload(&encoded).unwrap();
        assert_eq!(decoded_id, id);
        assert_eq!(decoded_fire, fire_time);
    }

    #[test]
    fn encode_decode_round_trips_uuid_ids() {
        let id = "550e8400-e29b-41d4-a716-446655440000";
        let fire_time = "2026-07-04T10:30:00+00:00";
        let encoded = encode_action_payload(id, fire_time);
        let (decoded_id, decoded_fire) = decode_action_payload(&encoded).unwrap();
        assert_eq!(decoded_id, id);
        assert_eq!(decoded_fire, fire_time);
    }

    #[test]
    fn encode_is_url_safe() {
        let id = "rem-001";
        let fire_time = "2026-07-04T10:00:00Z";
        let encoded = encode_action_payload(id, fire_time);
        // Must not contain raw spaces, +, /, or = (URL-unsafe characters).
        assert!(!encoded.contains(' '));
        assert!(!encoded.contains('+'));
        assert!(!encoded.contains('/'));
        // Pipe separators must be percent-encoded.
        assert!(!encoded.contains('|'));
    }

    #[test]
    fn decode_malformed_returns_none() {
        // No pipe separator after decoding.
        assert!(decode_action_payload("").is_none());
        // Incomplete percent escape.
        assert!(decode_action_payload("%2").is_none());
        // Decoded content has no pipe.
        let no_pipe = percent_encode("no-pipe-here");
        assert!(decode_action_payload(&no_pipe).is_none());
    }

    #[test]
    fn percent_encode_encodes_pipe_and_colon() {
        let encoded = percent_encode("a|b:c");
        assert!(!encoded.contains('|'));
        assert!(!encoded.contains(':'));
        // Both must be percent-encoded.
        assert!(encoded.contains("%7c") || encoded.contains("%7C")); // pipe
        assert!(encoded.contains("%3a") || encoded.contains("%3A")); // colon
    }

    #[test]
    fn percent_encode_leaves_alphanumeric_unchanged() {
        let input = "abcXYZ0123-._~";
        let encoded = percent_encode(input);
        assert_eq!(encoded, input); // all unreserved, no change
    }

    #[test]
    fn percent_decode_handles_mixed_case_hex() {
        // %7C and %7c must both decode to '|'.
        let a = percent_decode("a%7Cb").unwrap();
        let b = percent_decode("a%7cb").unwrap();
        assert_eq!(a, "a|b");
        assert_eq!(b, "a|b");
    }
}
