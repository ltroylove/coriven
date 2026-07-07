// Wave 6.1.2: Coriven tray webview configuration template.
//
// Copy this file to dist/config.js and fill in your values.
// dist/config.js is gitignored (the anon key is public by design, but keep
// project-specific URLs out of version control).
//
// The Supabase anon key is public by design — it is safe to ship in a desktop
// app binary. Do NOT use the service-role key here.
//
// In production / CI: generate dist/config.js from environment variables as part
// of the `npm run build` / `tauri build` step.

window.CORIVEN_CONFIG = {
  // Supabase project URL — from NEXT_PUBLIC_SUPABASE_URL in apps/web
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',

  // Supabase anon (public) key — from NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
};
