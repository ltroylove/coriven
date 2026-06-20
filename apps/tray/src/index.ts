// Entry point for the tray daemon
// Phases 7+ will wire up: tray icon, reminder poller, notifier, auth

async function main() {
  console.log('Personal Assistant tray daemon starting...')
}

main().catch(console.error)
