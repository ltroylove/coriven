// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This app contains NO database client, NO Supabase data access, NO recurrence math,
// NO "what's due" logic, and NO business rules. It only: shows a tray icon, manages
// auth lifecycle (Wave 6.1.2), and opens the web app in a browser.
// All durable logic lives in the backend API.
// Violations of this constraint are a review-gate failure.

pub mod auth;
pub mod secure_store;

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
/// Sets up plugins, commands, managed state, and the tray icon.
pub fn run() {
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
        // Wave 6.1.2: secure-storage + auth commands exposed to the webview.
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
        ])
        // Managed auth state — holds the in-memory access token (never persisted).
        .manage(auth::AuthState::new())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Coriven tray application");
}

/// The Coriven web app base URL. Configurable for local dev vs production.
/// Override by setting the CORIVEN_WEB_URL environment variable at runtime.
/// Default: http://localhost:3000 (local development).
///
/// Production usage: set CORIVEN_WEB_URL=https://your-app.vercel.app in the
/// process environment before launching, or supply via a config file in a later wave.
const DEFAULT_WEB_URL: &str = "http://localhost:3000";

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
    let snooze_item = MenuItem::with_id(app, "snooze_all", "Snooze All", true, None::<&str>)?;
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
            "snooze_all" => {
                // TODO(wave-6.2): Wire to the POST /api/tasks/snooze-all endpoint.
                eprintln!("[coriven-tray] Snooze All: not yet implemented (wave 6.2)");
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
