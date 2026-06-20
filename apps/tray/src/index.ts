import { CONFIG } from './config'
import { getValidSession } from './auth'
import { getDueReminders, DueReminder } from './db'
import { notify, notifyError } from './notifier'
import { createTray } from './tray'

const SNOOZE_WINDOW_MS = 5 * 60 * 1000 // don't re-fire within 5 minutes

const fired = new Map<string, number>() // reminderId → last fired timestamp
let cachedReminders: DueReminder[] = []

async function poll() {
  try {
    cachedReminders = await getDueReminders()
    console.log(`[poll] ${cachedReminders.length} upcoming reminders`)
  } catch (err) {
    console.error('[poll] error:', err)
  }
}

function checkDue() {
  const now = Date.now()
  for (const reminder of cachedReminders) {
    const remindAt = new Date(reminder.remind_at).getTime()
    if (remindAt > now) continue

    const lastFired = fired.get(reminder.id) ?? 0
    if (now - lastFired < SNOOZE_WINDOW_MS) continue

    if (reminder.task.status === 'done' || reminder.task.status === 'cancelled') continue

    fired.set(reminder.id, now)
    notify(reminder)
  }
}

async function main() {
  console.log('Personal Assistant tray starting...')

  try {
    await getValidSession()
    console.log('Authenticated successfully')
  } catch (err) {
    console.error('Authentication failed:', err)
    notifyError('Personal Assistant: authentication failed. Check your .env config.')
  }

  await poll()

  setInterval(poll, CONFIG.pollIntervalMs)
  setInterval(checkDue, CONFIG.checkIntervalMs)

  checkDue()

  createTray(() => {
    console.log('Quitting...')
    process.exit(0)
  })

  console.log('Tray daemon running.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
