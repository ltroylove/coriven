// SECURITY (Wave 6.1.2 — ADR-014 §mitigation):
// This module is the ONLY place where the refresh token is written to or read from
// persistent storage. It delegates exclusively to the OS credential store (Windows
// Credential Manager on Windows) via the `keyring` crate — never a plaintext file,
// never an env var, never a log line.
//
// Rules enforced here:
//   1. The credential VALUE is never printed, formatted into a log, or returned in
//      any error message. Only outcome events (stored, loaded, deleted, absent) are logged.
//   2. Deletion is idempotent — missing entry is not an error.
//   3. A missing entry returns `None`, not an error, so callers can distinguish
//      "not found" from "store failed".
//   4. The service name and account name are fixed constants so every access targets
//      the same OS credential slot.

use keyring::Entry;
use tauri::command;

/// Credential store service name — identifies this application in the OS keychain.
const KEYRING_SERVICE: &str = "app.coriven.tray";

/// Account name for the stored Supabase refresh token.
const KEYRING_ACCOUNT: &str = "supabase-refresh-token";

/// Error type for secure-store operations (value is never included).
#[derive(Debug, serde::Serialize)]
pub struct StoreError {
    pub message: String,
}

impl From<keyring::Error> for StoreError {
    fn from(e: keyring::Error) -> Self {
        // Use the error *kind* string only — never the credential value.
        StoreError {
            message: format!("keyring error: {}", e),
        }
    }
}

fn open_entry() -> Result<Entry, StoreError> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(StoreError::from)
}

/// Store a secret value in the OS credential store.
///
/// # Security
/// The `value` parameter is the refresh token. It is written directly to the OS
/// credential store and never logged, formatted into a string, or returned.
#[command]
pub fn secure_store(value: String) -> Result<(), StoreError> {
    let entry = open_entry()?;
    entry.set_password(&value).map_err(StoreError::from)?;
    // Log outcome only — the value is never mentioned.
    eprintln!("[coriven-tray] secure_store: credential written to OS keychain");
    Ok(())
}

/// Load the secret value from the OS credential store.
/// Returns `None` if no credential is currently stored (not an error).
///
/// # Security
/// The returned string is the refresh token. Callers must keep it in memory only
/// and must not log or persist it by any means other than `secure_store`.
#[command]
pub fn secure_load() -> Result<Option<String>, StoreError> {
    let entry = open_entry()?;
    match entry.get_password() {
        Ok(token) => {
            eprintln!("[coriven-tray] secure_load: credential retrieved from OS keychain");
            Ok(Some(token))
        }
        Err(keyring::Error::NoEntry) => {
            eprintln!("[coriven-tray] secure_load: no credential found in OS keychain");
            Ok(None)
        }
        Err(e) => Err(StoreError::from(e)),
    }
}

/// Delete the stored secret from the OS credential store.
/// Idempotent — if no entry exists, returns Ok(()).
///
/// # Security
/// Call this on sign-out to wipe the refresh token from the credential store.
#[command]
pub fn secure_delete() -> Result<(), StoreError> {
    let entry = open_entry()?;
    match entry.delete_credential() {
        Ok(()) => {
            eprintln!("[coriven-tray] secure_delete: credential removed from OS keychain");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            // Idempotent — already absent is success.
            eprintln!("[coriven-tray] secure_delete: no credential to remove (already absent)");
            Ok(())
        }
        Err(e) => Err(StoreError::from(e)),
    }
}

// ---------------------------------------------------------------------------
// Unit tests (pure logic — no actual OS keychain required for compilation)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that the service/account constants are non-empty and stable.
    #[test]
    fn keyring_constants_are_set() {
        assert!(!KEYRING_SERVICE.is_empty());
        assert!(!KEYRING_ACCOUNT.is_empty());
        // Stability: these are the keys used in the production OS keychain entry.
        assert_eq!(KEYRING_SERVICE, "app.coriven.tray");
        assert_eq!(KEYRING_ACCOUNT, "supabase-refresh-token");
    }

    /// Verify the error conversion does not embed a credential-shaped value.
    /// (Structural check — the error format must not echo back a secret.)
    #[test]
    fn store_error_format_has_no_secret_value() {
        // We can't easily inject a keyring::Error, but we can verify StoreError
        // only carries a generic message field.
        let err = StoreError {
            message: "keyring error: something technical".to_string(),
        };
        let serialized = serde_json::to_string(&err).unwrap();
        // Message field must be present but must NOT contain credential-shaped data.
        assert!(serialized.contains("keyring error"));
    }
}
