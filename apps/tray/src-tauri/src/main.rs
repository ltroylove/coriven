// Prevents additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// THIN-SHELL CONSTRAINT (ADR-003, §13.2):
// This binary is the entry point for the Coriven tray shell.
// It contains NO database access, NO Supabase client, NO business logic.
// All application logic is delegated to lib.rs (tray setup, command registration)
// and the backend API.

fn main() {
    coriven_tray_lib::run();
}
