// Coriven tray webview — main application script.
// SEC-1: Externalized from index.html to remove 'unsafe-inline' from script-src CSP.
// D-3: Adds listener for the coriven://auth/refresh-needed Tauri event.
//
// This file IS committed to VCS (see dist/.gitignore — only config.js and vendor/
// are excluded). It is served from 'self' in the CSP, replacing 'unsafe-inline'.

// ── Tauri invoke bridge ────────────────────────────────────────────────
// Tauri v2 with withGlobalTauri: true injects window.__TAURI__
// The invoke function is at window.__TAURI__.core.invoke
function invoke(cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args || {});
}

// ── Picker route ──────────────────────────────────────────────────────
//
// When this window was opened by `open_picker_window` in notify.rs, the
// URL is `index.html#/tray/picker?payload={encoded}`.
//
// The picker view is self-contained: it decodes the payload, renders three
// action buttons, calls `reminder_action` via invoke, then closes the window.
// No Supabase session, no config.js, and no network needed — the Rust side
// handles token auth and offline queueing.
//
// Payload encoding: `{reminderId}|{effectiveFireTime}` percent-encoded.
// The `|` separator is encoded as `%7C`/`%7c`. This matches the Rust
// `percent_encode` / `percent_decode` functions in notify.rs exactly.

// Set to true if this window is the picker; suppresses Supabase init below.
var IS_PICKER_ROUTE = false;

(function initPickerRoute() {
  var hash = window.location.hash; // e.g. "#/tray/picker?payload=rem-001%7C2026-07-04..."
  if (!hash.startsWith('#/tray/picker')) return; // not a picker window — fall through
  IS_PICKER_ROUTE = true;

  // Parse the payload query param out of the hash fragment.
  // The hash is "#/tray/picker?payload=..." so we split on '?'.
  var queryStr = hash.includes('?') ? hash.split('?')[1] : '';
  var params = new URLSearchParams(queryStr);
  var encodedPayload = params.get('payload') || '';

  // Decode the payload: percent-decode, then split on '|'.
  function percentDecode(str) {
    // Decode percent-encoded bytes; return null on malformed input.
    try {
      return decodeURIComponent(str.replace(/%([0-9a-fA-F]{2})/g, function(_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      }));
    } catch (_) {
      return null;
    }
  }

  var decoded = percentDecode(encodedPayload);
  var pipeIdx = decoded ? decoded.indexOf('|') : -1;
  var reminderId = decoded && pipeIdx > 0 ? decoded.slice(0, pipeIdx) : null;
  var effectiveFireTime = decoded && pipeIdx > 0 ? decoded.slice(pipeIdx + 1) : null;

  // Render the picker UI and hide all other panels.
  // Do this synchronously before DOMContentLoaded so there is no flash.
  document.addEventListener('DOMContentLoaded', function() {
    // Hide all other panels — this window is only the picker.
    ['loading-panel', 'offline-banner', 'status-panel', 'sign-in-panel'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    var pickerPanel = document.getElementById('picker-panel');
    pickerPanel.style.display = 'block';

    var reminderIdEl = document.getElementById('picker-reminder-id');
    if (reminderId) {
      // Show the reminder id abbreviated for the user (not the raw fire time —
      // the Rust side already has full context; we show just the id for reference).
      reminderIdEl.textContent = 'Reminder: ' + reminderId;
    } else {
      reminderIdEl.textContent = 'Could not decode reminder identity.';
      // Disable action buttons if we cannot determine the reminder.
      ['btn-snooze-15', 'btn-snooze-60', 'btn-dismiss'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) btn.disabled = true;
      });
      document.getElementById('picker-msg').textContent = 'Invalid payload — please close this window.';
      return;
    }

    // Helper: close the picker window after an action.
    function closePicker() {
      try {
        window.__TAURI__.window.getCurrentWindow().close().catch(function() {});
      } catch (_) {}
    }

    // Helper: perform a reminder action.
    // action: ReminderAction serialised shape as defined in actions.rs:
    //   Snooze  → { kind: 'snooze',  reminder_id: string, minutes: number }
    //   Dismiss → { kind: 'dismiss', reminder_id: string, effective_fire_time: string }
    async function doAction(action) {
      var msg = document.getElementById('picker-msg');
      msg.style.color = '#999';
      msg.textContent = 'Working…';
      ['btn-snooze-15', 'btn-snooze-60', 'btn-dismiss'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) btn.disabled = true;
      });
      try {
        await invoke('reminder_action', { action: action });
        msg.style.color = '#4ade80';
        msg.textContent = 'Done! Closing…';
        setTimeout(closePicker, 600);
      } catch (e) {
        // The Rust side queues offline snoozes, so an error here is unexpected
        // (e.g., ActionState not registered). Show a message but don't crash.
        msg.style.color = '#f87171';
        msg.textContent = 'Error: ' + (e && e.message ? e.message : String(e)) + ' (queued for retry)';
        // Re-enable buttons so the user can retry.
        ['btn-snooze-15', 'btn-snooze-60', 'btn-dismiss'].forEach(function(id) {
          var btn = document.getElementById(id);
          if (btn) btn.disabled = false;
        });
      }
    }

    document.getElementById('btn-snooze-15').addEventListener('click', function() {
      doAction({ kind: 'snooze', reminder_id: reminderId, minutes: 15 });
    });

    document.getElementById('btn-snooze-60').addEventListener('click', function() {
      doAction({ kind: 'snooze', reminder_id: reminderId, minutes: 60 });
    });

    document.getElementById('btn-dismiss').addEventListener('click', function() {
      doAction({ kind: 'dismiss', reminder_id: reminderId, effective_fire_time: effectiveFireTime });
    });
  });

})();

// ── Config validation (skipped for picker route) ──────────────────────
if (!IS_PICKER_ROUTE && (!window.CORIVEN_CONFIG || !window.CORIVEN_CONFIG.supabaseUrl || !window.CORIVEN_CONFIG.supabaseAnonKey)) {
  document.getElementById('loading-panel').textContent =
    'Configuration missing — copy dist/config.example.js to dist/config.js and fill in your Supabase URL and anon key.';
  throw new Error('CORIVEN_CONFIG not set — see dist/config.example.js');
}

// ── Supabase init (skipped entirely for picker route) ────────────────
if (!IS_PICKER_ROUTE) {

// ── Supabase client with custom storage adapter ───────────────────────
//
// SECURITY: The default Supabase storage (localStorage) is DISABLED.
// This adapter delegates ONLY the refresh token to the OS keychain via
// Tauri commands (secure_store / secure_load / secure_delete).
// The access token is held in memory by the Rust shell (notify_signed_in).
// Nothing is ever written to localStorage or any browser-persistent store.
//
// Key names the Supabase client will call on this adapter:
//   - "sb-<project-ref>-auth-token" — the full session JSON
//   - We store only the refresh_token field from this; the rest is discarded.

// In-memory map used for all non-refresh-token keys (access token, user info, etc.)
var memoryStore = new Map();

// The single keychain-backed key (all others go to memoryStore).
var REFRESH_TOKEN_STORAGE_KEY_SUFFIX = '-auth-token';

var customStorage = {
  async getItem(key) {
    if (key.endsWith(REFRESH_TOKEN_STORAGE_KEY_SUFFIX)) {
      // Reconstruct a minimal session JSON from the keychain refresh token
      // so Supabase can call refreshSession().
      try {
        var refreshToken = await invoke('secure_load');
        if (!refreshToken) return null;
        // Return a minimal session blob — Supabase only needs refresh_token
        // to call getSession() / refreshSession().
        return JSON.stringify({ refresh_token: refreshToken });
      } catch (e) {
        console.error('[coriven-tray] secure_load failed:', e.message || e);
        return null;
      }
    }
    return memoryStore.get(key) ?? null;
  },

  async setItem(key, value) {
    if (key.endsWith(REFRESH_TOKEN_STORAGE_KEY_SUFFIX)) {
      // SECURITY: Extract only the refresh token from the session blob.
      // The full session (including access token) must NOT be persisted.
      try {
        var session = JSON.parse(value);
        if (session && session.refresh_token) {
          // SECURITY: refresh token is passed to Rust — never logged here.
          await invoke('secure_store', { value: session.refresh_token });
        }
      } catch (e) {
        console.error('[coriven-tray] secure_store failed:', e.message || e);
      }
      // Do NOT store in memoryStore — the access token lives in Rust's AuthState.
      return;
    }
    memoryStore.set(key, value);
  },

  async removeItem(key) {
    if (key.endsWith(REFRESH_TOKEN_STORAGE_KEY_SUFFIX)) {
      try {
        await invoke('secure_delete');
      } catch (e) {
        console.error('[coriven-tray] secure_delete failed:', e.message || e);
      }
      return;
    }
    memoryStore.delete(key);
  },
};

// Create the Supabase client with our custom storage adapter and persistence disabled
// at the client level (the adapter handles the one durable credential).
var createClient = window.supabase.createClient;
var supabaseClient = createClient(
  window.CORIVEN_CONFIG.supabaseUrl,
  window.CORIVEN_CONFIG.supabaseAnonKey,
  {
    auth: {
      storage: customStorage,
      persistSession: true,   // let the adapter control what is actually persisted
      autoRefreshToken: true, // Supabase handles rotation; adapter re-persists via setItem
      detectSessionInUrl: false,
    },
  }
);

// ── UI helpers ────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).style.display = 'block'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function setError(msg) { document.getElementById('error-msg').textContent = msg || ''; }

function showLoading() {
  hide('sign-in-panel');
  hide('status-panel');
  show('loading-panel');
}
function showSignIn() {
  hide('loading-panel');
  hide('status-panel');
  show('sign-in-panel');
  setError('');
}
function showSignedIn(userId) {
  hide('loading-panel');
  hide('sign-in-panel');
  show('status-panel');
  document.getElementById('display-user-id').textContent = userId || '';
  updateAutostartLabel();
}

// ── Autostart label / toggle ──────────────────────────────────────────
async function updateAutostartLabel() {
  try {
    var enabled = await invoke('plugin:autostart|is_enabled');
    var label = document.getElementById('autostart-label');
    label.textContent = enabled ? 'Autostart: On' : 'Autostart: Off';
    document.getElementById('btn-toggle-autostart').textContent = enabled ? 'Disable' : 'Enable';
  } catch (e) {
    document.getElementById('autostart-label').textContent = 'Autostart: unknown';
  }
}

document.getElementById('btn-toggle-autostart').addEventListener('click', async function() {
  try {
    var enabled = await invoke('plugin:autostart|is_enabled');
    if (enabled) {
      await invoke('plugin:autostart|disable');
    } else {
      await invoke('plugin:autostart|enable');
    }
    await updateAutostartLabel();
  } catch (e) {
    console.error('[coriven-tray] autostart toggle failed:', e.message || e);
  }
});

// ── Auth lifecycle ────────────────────────────────────────────────────

// Notify the Rust shell of the current session state.
// SECURITY: Only user_id is sent; access_token is sent once and not logged.
async function notifyRust(session) {
  if (session) {
    await invoke('notify_signed_in', {
      // SECURITY: access_token is passed to Rust memory; not logged.
      accessToken: session.access_token,
      userId: session.user.id,
    });
  } else {
    await invoke('notify_signed_out');
  }
}

// Sign in with email + password.
async function signIn(email, password) {
  var btn = document.getElementById('btn-sign-in');
  btn.disabled = true;
  setError('');
  try {
    var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    var data = result.data;
    var error = result.error;
    if (error) {
      // SECURITY: error.message from Supabase never contains credentials.
      setError(error.message || 'Sign-in failed. Please try again.');
      return;
    }
    await notifyRust(data.session);

    // Enable autostart on first successful sign-in.
    try {
      var isEnabled = await invoke('plugin:autostart|is_enabled');
      if (!isEnabled) {
        await invoke('plugin:autostart|enable');
        console.log('[coriven-tray] Autostart enabled after first sign-in');
      }
    } catch (e) {
      console.error('[coriven-tray] Failed to enable autostart:', e.message || e);
    }

    showSignedIn(data.session.user.id);
  } catch (e) {
    setError('Unexpected error — please try again.');
    console.error('[coriven-tray] signIn error:', e.message || e);
  } finally {
    btn.disabled = false;
  }
}

// Sign out: clear Supabase session + keychain credential + Rust auth state.
async function signOut() {
  var btn = document.getElementById('btn-sign-out');
  btn.disabled = true;
  try {
    await supabaseClient.auth.signOut();
    // The Supabase client calls customStorage.removeItem() which calls secure_delete.
    // Also explicitly notify Rust to clear in-memory token.
    await invoke('notify_signed_out');
    showSignIn();
  } catch (e) {
    console.error('[coriven-tray] signOut error:', e.message || e);
    // Still show sign-in on error — don't leave the user stuck.
    showSignIn();
  } finally {
    btn.disabled = false;
  }
}

// Try to restore a session silently on startup.
// Loads the refresh token directly from the OS keychain and calls refreshSession()
// explicitly — avoids relying on getSession() accepting the minimal storage shape.
async function restoreSession() {
  showLoading();
  try {
    await invoke('notify_restore_pending');
    var refreshToken = await invoke('secure_load');
    if (!refreshToken) {
      await invoke('notify_signed_out');
      showSignIn();
      return;
    }
    var result = await supabaseClient.auth.refreshSession({ refresh_token: refreshToken });
    var data = result.data;
    var error = result.error;
    if (error) {
      console.error('[coriven-tray] Session restore error:', error.message);
      // Treat any restore error as revoked/expired — clear credential and prompt.
      await invoke('secure_delete');
      await invoke('notify_signed_out');
      showSignIn();
      return;
    }
    if (data.session) {
      await notifyRust(data.session);
      showSignedIn(data.session.user.id);
    } else {
      // No stored refresh token — show sign-in.
      await invoke('notify_signed_out');
      showSignIn();
    }
  } catch (e) {
    // Network error or Tauri bridge error — show offline banner + sign-in.
    console.error('[coriven-tray] Session restore exception:', e.message || e);
    document.getElementById('offline-banner').style.display = 'block';
    await invoke('notify_signed_out').catch(function() {});
    showSignIn();
  }
}

// ── Supabase auth state listener ──────────────────────────────────────
// Handles token rotation: when Supabase rotates the refresh token, the
// custom storage adapter's setItem() is called and re-persists the new token.
supabaseClient.auth.onAuthStateChange(async function(event, session) {
  if (event === 'TOKEN_REFRESHED' && session) {
    // Token rotation — the adapter's setItem() already persisted the new
    // refresh token. Just keep Rust's in-memory access token current.
    await invoke('notify_signed_in', {
      accessToken: session.access_token,
      userId: session.user.id,
    }).catch(function() {});
  } else if (event === 'SIGNED_OUT') {
    await invoke('notify_signed_out').catch(function() {});
  }
});

// ── D-3: coriven://auth/refresh-needed event listener ─────────────────
// Rust emits this event on 401 (in poll.rs and actions.rs). The webview
// listens here and calls supabase.auth.refreshSession() to restore the
// session. On success, notify_signed_in is called so the poll loop can
// resume with the new access token.
//
// Event name confirmed: "coriven://auth/refresh-needed" — matches the
// exact string passed to app.emit() in poll.rs (line ~308) and actions.rs.
//
// If the webview is not open (common for a background tray), the event is
// not received and snoozes are queued. On the next tray-window open,
// restoreSession() re-establishes the session proactively.
(function setupAuthRefreshListener() {
  // Guard: only set up once and only on non-picker routes.
  if (IS_PICKER_ROUTE) return;

  // Wait for Tauri's __TAURI__ to be ready before attaching the listener.
  // withGlobalTauri: true ensures window.__TAURI__ is available synchronously
  // once the script runs, but we guard defensively.
  function attachListener() {
    if (!window.__TAURI__ || !window.__TAURI__.event) {
      console.warn('[coriven-tray] Tauri event API not available — refresh listener not attached');
      return;
    }
    window.__TAURI__.event.listen('coriven://auth/refresh-needed', async function() {
      console.log('[coriven-tray] auth/refresh-needed received — calling refreshSession()');
      try {
        var result = await supabaseClient.auth.refreshSession();
        var data = result.data;
        var error = result.error;
        if (error) {
          console.error('[coriven-tray] refreshSession failed:', error.message);
          // Token is unrecoverable — clear state and show sign-in.
          await invoke('notify_signed_out').catch(function() {});
          showSignIn();
          return;
        }
        if (data && data.session) {
          // Hand the new access token to Rust so the poll loop can resume.
          await invoke('notify_signed_in', {
            accessToken: data.session.access_token,
            userId: data.session.user.id,
          }).catch(function() {});
          console.log('[coriven-tray] Token refreshed — Rust notified');
        } else {
          // No session after refresh — user is effectively signed out.
          await invoke('notify_signed_out').catch(function() {});
          showSignIn();
        }
      } catch (e) {
        console.error('[coriven-tray] refreshSession exception:', e.message || e);
      }
    });
    console.log('[coriven-tray] auth/refresh-needed listener registered');
  }

  // The script runs after DOM is parsed but Tauri bridge is injected before
  // any user scripts run (withGlobalTauri). Attach immediately.
  attachListener();
})();

// ── Wire up button events ─────────────────────────────────────────────
document.getElementById('btn-sign-in').addEventListener('click', function() {
  var email = document.getElementById('email').value.trim();
  var password = document.getElementById('password').value;
  if (!email || !password) {
    setError('Please enter your email and password.');
    return;
  }
  signIn(email, password);
});

document.getElementById('password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-sign-in').click();
});

document.getElementById('btn-sign-out').addEventListener('click', signOut);

document.getElementById('btn-close-window').addEventListener('click', function() {
  // Close the sign-in window via Rust command — tray icon stays active.
  invoke('close_window').catch(function() {});
});

// ── Startup ───────────────────────────────────────────────────────────
// On DOMContentLoaded, try to restore a session from the keychain.
document.addEventListener('DOMContentLoaded', function() {
  restoreSession();
});

} // end if (!IS_PICKER_ROUTE)
