// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This app contains NO database client, NO Supabase data access, NO recurrence math,
// NO "what's due" logic, and NO business rules. It only: shows a tray icon, manages
// auth lifecycle (Wave 6.1.2), polls the backend for due reminders (Wave 6.2.1),
// fires native Windows toasts, handles snooze/dismiss actions (Wave 6.2.2),
// delivers the daily briefing notification (Wave 6.3.2), and alerts on pending
// approvals (Wave 6.3.2). All durable logic lives in the backend API.
// Violations of this constraint are a review-gate failure.

pub mod actions;
pub mod approvals;
pub mod auth;
pub mod briefing;
pub mod notify;
pub mod offline;
pub mod poll;
pub mod secure_store;

use std::sync::{Arc, Mutex};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;

// Re-export command functions so generate_handler! can reference them here in lib.rs.
use auth::{auth_status, notify_restore_pending, notify_signed_in, notify_signed_out};
use secure_store::{secure_delete, secure_load, secure_store};

/// Entry point called from main.rs.
/// Sets up plugins, commands, managed state, the tray icon, and the poll loop.
pub fn run() {
    // Build a Tokio runtime for the background poll loop. The runtime is kept
    // alive for the lifetime of the process — it is NOT dropped on setup exit.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("failed to build Tokio runtime for poll loop");
    // Enter the runtime so Tauri's async tasks (if any) can also use it.
    let _rt_guard = rt.enter();

    tauri::Builder::default()
        // Wave 6.1.2: autostart plugin — registers with Windows Task Scheduler /
        // Registry (via the auto-launch crate). MacosLauncher::LaunchAgent is used
        // for Mac when that target is eventually built (Epic 8). No hand-rolled
        // registry code — the plugin handles it cross-platform.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None, // no extra CLI args on autostart launch
        ))
        .plugin(tauri_plugin_opener::init())
        // Wave 6.2.1: notification plugin — native Windows toast delivery.
        // Action buttons are not the primary path (Wave 6.2.2 uses picker window —
        // see notify.rs module comment for the rationale).
        .plugin(tauri_plugin_notification::init())
        // Wave 6.1.2: secure-storage + auth commands exposed to the webview.
        // Wave 6.2.2: reminder_action command for the picker window.
        // These are the ONLY paths through which the refresh token is stored or loaded.
        .invoke_handler(tauri::generate_handler![
            // Secure storage bridge (refresh token ↔ OS keychain)
            secure_store,
            secure_load,
            secure_delete,
            // Auth lifecycle (in-memory access token + status)
            auth_status,
            notify_signed_in,
            notify_signed_out,
            notify_restore_pending,
            // Wave 6.2.2: picker window action handler
            reminder_action,
            // Wave 6.2.2: open picker window for a reminder (deep link from toast click)
            open_reminder_picker,
            // Close the sign-in/status window from JS.
            close_window,
        ])
        // Managed auth state — holds the in-memory access token (never persisted).
        .manage(auth::AuthState::new())
        .setup(|app| {
            // Wave 6.2.2: register action state (suppress store + snooze queue).
            app.manage(actions::ActionState::new(app.handle()));

            // D-4 fix: register the shared de-dup cache so dismiss and the poll
            // loop share a single Mutex-guarded owner — no more lost-update race.
            let dedup_cache = poll::DedupeCache::load(app.handle());
            let shared_dedup = Arc::new(Mutex::new(dedup_cache));
            app.manage(SharedDedupeCache(shared_dedup.clone()));

            setup_tray(app.handle())?;

            // Wave 6.2.1: start the background poll loop.
            // The loop reads the API base URL from the environment (same source as
            // `web_app_url()`) so local dev and production use consistent config.
            let api_base_url = web_app_url();
            let poll_state = Arc::new(Mutex::new(poll::PollState::new(api_base_url)));

            // Share poll_state with the tray menu event handler for Snooze All.
            app.manage(SharedPollState(poll_state.clone()));

            poll::start_poll_loop(app.handle().clone(), poll_state);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Coriven tray application")
        .run(|_app, event| {
            // Keep the process alive when all windows are closed — the tray icon
            // is the app's presence. The Quit menu item calls app.exit(0) directly.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

/// Wrapper so `Arc<Mutex<PollState>>` can be stored in Tauri managed state.
pub struct SharedPollState(pub Arc<Mutex<poll::PollState>>);

/// Shared de-dup cache — single owner for both the poll loop and dismiss actions.
///
/// D-4 fix: wrapping `DedupeCache` in a `Mutex` here prevents the lost-update race
/// where `handle_dismiss` wrote to the cache file independently of the poll loop's
/// in-memory `DedupeCache` copy. With this shared owner:
///   - The poll loop locks, reads/writes, then unlocks (no lock held across await).
///   - `handle_dismiss` locks, inserts the key, persists, then unlocks.
/// These two operations are serialised by the Mutex, eliminating the race.
pub struct SharedDedupeCache(pub Arc<Mutex<poll::DedupeCache>>);

/// The Coriven web app base URL. Configurable for local dev vs production.
/// Override by setting the CORIVEN_WEB_URL environment variable at runtime.
/// Default: http://localhost:3000 (local development).
///
/// Production usage: set CORIVEN_WEB_URL=https://your-app.vercel.app in the
/// process environment before launching, or supply via a config file in a later wave.
const DEFAULT_WEB_URL: &str = "https://coriven.app";

/// Returns the configured web app URL. Reads CORIVEN_WEB_URL from the environment
/// at runtime, falling back to the compiled-in default.
fn web_app_url() -> String {
    std::env::var("CORIVEN_WEB_URL").unwrap_or_else(|_| DEFAULT_WEB_URL.to_string())
}

/// Open the Coriven web app in the user's default browser.
fn open_app(app: &AppHandle) {
    let url = web_app_url();
    if let Err(e) = app.opener().open_url(&url, None::<&str>) {
        eprintln!("[coriven-tray] Failed to open browser at {url}: {e}");
    }
}

/// Decode a PNG from raw bytes into a Tauri `Image`.
/// The PNG bytes are embedded at compile time via `include_bytes!`.
fn load_icon_from_png(png_bytes: &[u8]) -> Image<'static> {
    let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    let mut reader = decoder.read_info().expect("Failed to read PNG info for tray icon");
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("Failed to decode PNG frame for tray icon");
    let width = info.width;
    let height = info.height;
    // Ensure RGBA — convert RGB to RGBA if needed.
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => {
            let rgb = &buf[..info.buffer_size()];
            rgb.chunks(3)
                .flat_map(|c| [c[0], c[1], c[2], 255u8])
                .collect()
        }
        _ => panic!("Unsupported PNG color type for tray icon — use RGBA or RGB PNG"),
    };
    Image::new_owned(rgba, width, height)
}

/// Build the system tray icon and menu, then attach event handlers.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    // --- Build tray menu ---
    let open_item = MenuItem::with_id(app, "open_app", "Open App", true, None::<&str>)?;
    let sign_in_item = MenuItem::with_id(app, "sign_in", "Sign In…", true, None::<&str>)?;
    let sign_out_item = MenuItem::with_id(app, "sign_out", "Sign Out", true, None::<&str>)?;

    // Wave 6.2.2: "Snooze All" label shows offline indicator when in cached-data mode.
    // The label is static at build time; runtime indication is via the eprintln log.
    // A future wave can update the menu item label dynamically via the tray handle.
    let snooze_item = MenuItem::with_id(app, "snooze_all", "Snooze All (1h)", true, None::<&str>)?;

    // D-2 fix: "Due reminders…" is the PRIMARY reliable trigger for the picker.
    // Toast-click callbacks are NOT available in tauri-plugin-notification v2.3.x on
    // Windows desktop (the plugin uses notify-rust with no action handler surface).
    // This tray menu item is always reachable regardless of toast-click reliability.
    let due_reminders_item = MenuItem::with_id(
        app,
        "due_reminders",
        "Due reminders\u{2026}",
        true,
        None::<&str>,
    )?;

    // D-2 fix: reliable tray-menu paths for briefing and approval deep-links.
    // These replace the toast-click path (not reachable in this plugin version).
    let open_today_item = MenuItem::with_id(
        app,
        "open_today",
        "Today's briefing",
        true,
        None::<&str>,
    )?;
    let open_approvals_item = MenuItem::with_id(
        app,
        "open_approvals",
        "Pending approvals",
        true,
        None::<&str>,
    )?;

    let autostart_item = MenuItem::with_id(
        app,
        "toggle_autostart",
        "Toggle Autostart",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &sign_in_item,
            &sign_out_item,
            &due_reminders_item,
            &open_today_item,
            &open_approvals_item,
            &snooze_item,
            &autostart_item,
            &quit_item,
        ],
    )?;

    // Load the tray icon from the embedded PNG bytes compiled into the binary.
    // Placeholder icon — replace with the final Coriven brand asset before release.
    let icon = load_icon_from_png(include_bytes!("../icons/32x32.png"));

    // --- Build tray icon ---
    let _tray = TrayIconBuilder::with_id("coriven-tray")
        .tooltip("Coriven")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_app" => {
                open_app(app);
            }
            "sign_in" => {
                // Open the built-in sign-in window.
                open_sign_in_window(app);
            }
            "sign_out" => {
                // Sign-out: the webview handles Supabase sign-out + secure_delete.
                // Opening the window lets the user trigger sign-out from the UI.
                open_sign_in_window(app);
            }
            "open_today" => {
                // D-2 fix (reliable path): open the /today briefing page.
                // Toast-click not available in tauri-plugin-notification v2.3.x;
                // this tray-menu item is the primary path for the briefing deep-link.
                let url = web_app_url();
                crate::briefing::open_today_page(app, &url);
            }
            "open_approvals" => {
                // D-2 fix (reliable path): open the /approvals page.
                // Same rationale as open_today — toast-click is best-effort only.
                let url = web_app_url();
                crate::approvals::open_approvals_page(app, &url);
            }
            "due_reminders" => {
                // D-2 fix (primary path): open picker for the first currently-due
                // un-dismissed reminder, or all of them sequentially.
                //
                // Design rationale: The notification plugin on Windows desktop (v2.3.x)
                // does not expose a click-callback API — toast clicks cannot reliably
                // trigger Rust code in unsigned/unpackaged builds. This tray-menu item
                // is therefore the PRIMARY trigger for the picker window. The toast
                // fires a notification so the user knows something is due; the menu
                // item provides the reliable action path.
                //
                // We open a picker for the first due, un-dismissed reminder from the
                // last cached poll payload. If none are due, we log and do nothing.
                let app_clone = app.clone();
                let poll_state = app
                    .try_state::<SharedPollState>()
                    .map(|s| s.0.clone());

                if let Some(ps) = poll_state {
                    tokio::spawn(async move {
                        open_due_reminder_picker(app_clone, ps);
                    });
                } else {
                    eprintln!("[coriven-tray] tray: Due reminders — SharedPollState unavailable");
                }
            }
            "snooze_all" => {
                // Wave 6.2.2: snooze every currently due reminder by 60 minutes.
                // Uses the cached due payload so it works even when briefly offline.
                let app_clone = app.clone();
                let poll_state = app
                    .try_state::<SharedPollState>()
                    .map(|s| s.0.clone());

                if let Some(ps) = poll_state {
                    // Spawn as a Tokio task — the menu event handler must not block.
                    tokio::spawn(async move {
                        // Check offline status and log appropriately.
                        let due_cache = crate::offline::DueCache::load(&app_clone);
                        if due_cache.is_offline {
                            eprintln!(
                                "[coriven-tray] tray: Snooze All invoked in cached-data mode — {} reminder(s) in cache",
                                due_cache.reminders.len()
                            );
                        }
                        actions::snooze_all(app_clone, ps).await;
                    });
                } else {
                    eprintln!("[coriven-tray] tray: Snooze All — SharedPollState unavailable");
                }
            }
            "toggle_autostart" => {
                // Toggle autostart via the autostart plugin.
                use tauri_plugin_autostart::ManagerExt;
                let autostart_manager = app.autolaunch();
                match autostart_manager.is_enabled() {
                    Ok(true) => {
                        if let Err(e) = autostart_manager.disable() {
                            eprintln!("[coriven-tray] Failed to disable autostart: {e}");
                        } else {
                            eprintln!("[coriven-tray] Autostart disabled");
                        }
                    }
                    Ok(false) => {
                        if let Err(e) = autostart_manager.enable() {
                            eprintln!("[coriven-tray] Failed to enable autostart: {e}");
                        } else {
                            eprintln!("[coriven-tray] Autostart enabled");
                        }
                    }
                    Err(e) => {
                        eprintln!("[coriven-tray] Failed to query autostart state: {e}");
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                eprintln!("[coriven-tray] Unknown menu event: {other}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Left-click: open sign-in/status window.
                open_sign_in_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Open (or focus) the sign-in/status window.
/// This is a WebviewWindow pointing at the bundled dist/index.html.
fn open_sign_in_window(app: &AppHandle) {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // If the window already exists, bring it to front.
    if let Some(win) = app.get_webview_window("sign-in") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // Create the sign-in window.
    match WebviewWindowBuilder::new(app, "sign-in", WebviewUrl::App("index.html".into()))
        .title("Coriven — Sign In")
        .inner_size(400.0, 460.0)
        .resizable(false)
        .always_on_top(false)
        .center()
        .build()
    {
        Ok(_) => {
            eprintln!("[coriven-tray] Sign-in window opened");
        }
        Err(e) => {
            eprintln!("[coriven-tray] Failed to open sign-in window: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// D-2 fix: open picker for due reminders from the tray menu
// ---------------------------------------------------------------------------

/// Open the snooze/dismiss picker for the first currently-due, un-dismissed
/// reminder from the cached poll payload. Called by the "Due reminders…" tray
/// menu item — this is the PRIMARY reliable action path (see menu handler comment).
///
/// If multiple reminders are due, only the first is opened (the user can re-click
/// the menu item after acting on each). This keeps the UI simple and avoids
/// spawning many windows at once.
///
/// If no due reminders are cached, logs and returns without opening a window.
fn open_due_reminder_picker(app: AppHandle, poll_state: Arc<Mutex<poll::PollState>>) {
    let due_cache = crate::offline::DueCache::load(&app);

    // Read dismissed keys from the suppress store.
    let dismissed_keys: std::collections::HashSet<String> = app
        .try_state::<actions::ActionState>()
        .and_then(|s| s.suppress_store.lock().ok().map(|st| st.dismissed.clone()))
        .unwrap_or_default();

    // Find the first due, un-dismissed reminder.
    let first_due = due_cache.reminders.into_iter().find(|r| {
        let key = poll::dedup_key(r);
        !dismissed_keys.contains(&key)
    });

    match first_due {
        Some(reminder) => {
            let effective_fire_time = poll::effective_fire_time(&reminder).to_string();
            eprintln!(
                "[coriven-tray] tray: opening picker for reminder_id={} (tray-menu trigger)",
                reminder.id
            );
            notify::open_picker_window(&app, &reminder.id, &effective_fire_time);
        }
        None => {
            eprintln!("[coriven-tray] tray: Due reminders — no due un-dismissed reminders cached");
        }
    }

    // Suppress the unused variable warning for poll_state (kept for future multi-reminder support).
    let _ = poll_state;
}

// ---------------------------------------------------------------------------
// Wave 6.2.2: Tauri commands exposed to the picker window webview
// ---------------------------------------------------------------------------

/// Handle a snooze or dismiss action from the picker window (or any future
/// button source). This command is the single entry point for all reminder
/// actions — the handler layer is button-source-agnostic.
///
/// Called from the picker window's JavaScript via `invoke('reminder_action', { action })`.
///
/// # Arguments
/// - `action`: a JSON-serialised `ReminderAction` (`{ kind: "snooze", reminder_id, minutes }`
///   or `{ kind: "dismiss", reminder_id, effective_fire_time }`).
///
/// # Security
/// No token is passed through this command. The token is read from `AuthState`
/// managed state inside `handle_action` — it never crosses the IPC boundary.
#[tauri::command]
async fn reminder_action(
    app: AppHandle,
    action: actions::ReminderAction,
) -> Result<(), String> {
    let poll_state = app
        .try_state::<SharedPollState>()
        .ok_or_else(|| "poll state unavailable".to_string())?
        .0
        .clone();

    // Spawn fire-and-forget so the command returns immediately to the webview.
    let app_clone = app.clone();
    tokio::spawn(async move {
        actions::handle_action(app_clone, action, poll_state).await;
    });

    Ok(())
}

/// Open the snooze/dismiss picker window for a specific reminder occurrence.
///
/// Called from the webview (e.g., on notification click event) with the encoded
/// payload produced by `notify::encode_action_payload`.
///
/// This command is the bridge between a notification click and the picker window.
/// It is also callable from the web UI for testing.
#[tauri::command]
fn open_reminder_picker(
    app: AppHandle,
    encoded_payload: String,
) -> Result<(), String> {
    match notify::decode_action_payload(&encoded_payload) {
        Some((reminder_id, effective_fire_time)) => {
            notify::open_picker_window(&app, &reminder_id, &effective_fire_time);
            Ok(())
        }
        None => {
            eprintln!(
                "[coriven-tray] open_reminder_picker: malformed payload (len={})",
                encoded_payload.len()
            );
            Err("malformed action payload".to_string())
        }
    }
}

/// Close the sign-in/status window from the webview JS.
/// Safer than calling the Tauri JS window API directly (avoids permission edge-cases).
#[tauri::command]
fn close_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("sign-in") {
        let _ = win.close();
    }
}
