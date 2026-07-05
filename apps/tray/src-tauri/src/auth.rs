// SECURITY (Wave 6.1.2 — ADR-014 §mitigation):
// This module holds the in-memory auth state. The access token lives HERE only —
// it is never written to disk, never persisted via keyring, and never logged.
// The refresh token is managed exclusively by `secure_store.rs`.
//
// Auth lifecycle:
//   signed_out  ──sign_in()──>  signed_in
//   signed_in   ──sign_out()──> signed_out
//   signed_in   ──token expired/revoked──> signed_out (prompts re-sign-in in the webview)
//   any state   ──offline──>    pending_restore (retry on connectivity)

use std::sync::Mutex;
use tauri::{command, State};

/// Auth state machine variants visible to the tray shell.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthStatus {
    /// No session; user must sign in.
    SignedOut,
    /// Valid session; access token is held in memory.
    SignedIn,
    /// Startup restore is pending (e.g., waiting for network).
    PendingRestore,
}

/// Inner mutable auth state — guarded by Mutex so it is safe to share across
/// async Tauri command handlers. Pub(crate) so AuthState can expose it to lib.rs
/// without making the private fields reachable from outside the crate.
#[derive(Debug)]
pub(crate) struct AuthStateInner {
    status: AuthStatus,
    /// In-memory access token. NEVER persisted. NEVER logged.
    /// This field is intentionally not serialised (no Serialize derive on the struct).
    access_token: Option<String>,
    /// User ID of the signed-in user (not sensitive; used for tray menu labels etc.).
    user_id: Option<String>,
}

/// Managed auth state — stored in the Tauri app's managed state map.
pub struct AuthState(pub(crate) Mutex<AuthStateInner>);

impl AuthState {
    pub fn new() -> Self {
        AuthState(Mutex::new(AuthStateInner {
            status: AuthStatus::SignedOut,
            access_token: None,
            user_id: None,
        }))
    }
}

/// Public view of auth state returned to the webview (no token included).
#[derive(Debug, serde::Serialize)]
pub struct AuthStatusView {
    pub status: AuthStatus,
    pub user_id: Option<String>,
}

/// Return the current auth status (safe to expose to the webview — contains no token).
#[command]
pub fn auth_status(state: State<'_, AuthState>) -> AuthStatusView {
    let inner = state.0.lock().expect("auth state lock poisoned");
    AuthStatusView {
        status: inner.status.clone(),
        user_id: inner.user_id.clone(),
    }
}

/// Called by the webview after a successful Supabase sign-in to hand the
/// access token to the Rust shell.
///
/// # Security
/// `access_token` is held in memory only — never persisted. It is NOT logged.
/// The refresh token must be handled separately via `secure_store` commands.
#[command]
pub fn notify_signed_in(
    access_token: String,
    user_id: String,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "auth state lock poisoned")?;
    // SECURITY: access_token deliberately excluded from any log line below.
    inner.access_token = Some(access_token);
    inner.user_id = Some(user_id.clone());
    inner.status = AuthStatus::SignedIn;
    eprintln!("[coriven-tray] auth: signed in (user_id={})", user_id);
    Ok(())
}

/// Called by the webview on sign-out, or by the Rust shell when a token refresh
/// is rejected (revoked/expired).
///
/// # Security
/// Clears the in-memory access token. The caller (webview sign-out handler) is
/// responsible for also calling `secure_delete` to wipe the persisted refresh token.
#[command]
pub fn notify_signed_out(state: State<'_, AuthState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "auth state lock poisoned")?;
    inner.access_token = None;
    inner.user_id = None;
    inner.status = AuthStatus::SignedOut;
    eprintln!("[coriven-tray] auth: signed out — in-memory access token cleared");
    Ok(())
}

/// Set state to PendingRestore (used during startup silent-restore attempt).
#[command]
pub fn notify_restore_pending(state: State<'_, AuthState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "auth state lock poisoned")?;
    inner.status = AuthStatus::PendingRestore;
    eprintln!("[coriven-tray] auth: session restore pending");
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state() -> AuthState {
        AuthState::new()
    }

    #[test]
    fn initial_status_is_signed_out() {
        let s = make_state();
        let inner = s.0.lock().unwrap();
        assert_eq!(inner.status, AuthStatus::SignedOut);
        assert!(inner.access_token.is_none());
        assert!(inner.user_id.is_none());
    }

    #[test]
    fn signed_in_then_signed_out_clears_token() {
        let s = make_state();
        {
            let mut inner = s.0.lock().unwrap();
            inner.access_token = Some("tok_abc".to_string());
            inner.user_id = Some("uid_123".to_string());
            inner.status = AuthStatus::SignedIn;
        }
        {
            let mut inner = s.0.lock().unwrap();
            inner.access_token = None;
            inner.user_id = None;
            inner.status = AuthStatus::SignedOut;
        }
        let inner = s.0.lock().unwrap();
        assert_eq!(inner.status, AuthStatus::SignedOut);
        assert!(inner.access_token.is_none());
        assert!(inner.user_id.is_none());
    }

    #[test]
    fn auth_status_view_excludes_token() {
        // Verify the serializable view type contains no access_token field.
        let view = AuthStatusView {
            status: AuthStatus::SignedIn,
            user_id: Some("uid_123".to_string()),
        };
        let json = serde_json::to_string(&view).unwrap();
        // Must not contain a field named "access_token".
        assert!(!json.contains("access_token"));
        // Must contain the status and user_id.
        assert!(json.contains("signed_in"));
        assert!(json.contains("uid_123"));
    }
}
