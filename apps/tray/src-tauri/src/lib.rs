// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This app contains NO database client, NO Supabase data access, NO recurrence math,
// NO "what's due" logic, and NO business rules. It only: shows a tray icon, opens the
// web app in a browser, and quits. All durable logic lives in the backend API.
// Violations of this constraint are a review-gate failure.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};
use tauri_plugin_opener::OpenerExt;

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
    let snooze_item = MenuItem::with_id(app, "snooze_all", "Snooze All", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &snooze_item, &quit_item])?;

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
            "snooze_all" => {
                // TODO(wave-6.2): Wire to the POST /api/tasks/snooze-all endpoint.
                // This menu item is intentionally inert in wave 6.1.1 — it exists
                // to establish the fixed tray menu contract (Open App / Snooze All / Quit).
                eprintln!("[coriven-tray] Snooze All: not yet implemented (wave 6.2)");
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                eprintln!("[coriven-tray] Unknown menu event: {other}");
            }
        })
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Left-click on the tray icon — no action this wave.
                // Wave 6.1.2 may show a status popover here.
            }
        })
        .build(app)?;

    Ok(())
}
