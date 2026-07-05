// Prevents additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This binary is the entry point for the Coriven tray shell.
// It contains NO database access, NO Supabase client, NO business logic.
// All application logic is delegated to lib.rs (tray setup) and the backend API.

use coriven_tray_lib::setup_tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Coriven tray application");
}
