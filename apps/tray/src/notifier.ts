// eslint-disable-next-line @typescript-eslint/no-require-imports
const notifier = require('node-notifier') as {
  notify: (opts: Record<string, unknown>, cb?: (err: Error | null, response: string, metadata: Record<string, unknown>) => void) => void
}
import * as path from 'path'
import { DueReminder, snoozeReminder, fireReminder } from './db'

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png')

export function notify(reminder: DueReminder) {
  const taskTitle = reminder.task.title
  const remindAt = new Date(reminder.remind_at)
  const isOverdue = remindAt < new Date()

  const message = isOverdue
    ? `Due: ${taskTitle}`
    : `Upcoming: ${taskTitle}`

  notifier.notify(
    {
      title: 'Personal Assistant',
      message,
      icon: ICON_PATH,
      sound: true,
      wait: true,
      actions: ['Snooze 15m', 'Snooze 1h', 'Dismiss'],
    },
    async (_err, _response, metadata) => {
      const action = metadata?.activationValue as string | undefined
      try {
        if (action === 'Snooze 15m') {
          await snoozeReminder(reminder.id, 15)
        } else if (action === 'Snooze 1h') {
          await snoozeReminder(reminder.id, 60)
        } else {
          await fireReminder(
            reminder.id,
            reminder.recurrence_type,
            reminder.remind_at,
            reminder.recurrence_end_at,
          )
        }
      } catch (err) {
        console.error('notifier action error:', err)
      }
    },
  )
}

export function notifyError(message: string) {
  notifier.notify({
    title: 'Personal Assistant',
    message,
    icon: ICON_PATH,
    sound: false,
  })
}
