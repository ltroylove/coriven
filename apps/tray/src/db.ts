import { createClient } from '@supabase/supabase-js'
import { CONFIG } from './config'
import { getValidSession } from './auth'

export type DueReminder = {
  id: string
  task_id: string
  remind_at: string
  recurrence_type: string
  recurrence_end_at: string | null
  snoozed_until: string | null
  last_fired_at: string | null
  task: {
    title: string
    status: string
  }
}

function client(accessToken: string) {
  return createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })
}

export async function getDueReminders(): Promise<DueReminder[]> {
  const session = await getValidSession()
  const db = client(session.access_token)

  const now = new Date()
  const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('task_reminders')
    .select('*, task:tasks(title, status)')
    .lte('remind_at', cutoff)
    .or(`snoozed_until.is.null,snoozed_until.lte.${now.toISOString()}`)
    .not('task.status', 'in', '("done","cancelled")')
    .order('remind_at', { ascending: true })

  if (error) throw new Error(`getDueReminders: ${error.message}`)
  return (data ?? []).filter(r => r.task !== null) as DueReminder[]
}

export async function snoozeReminder(id: string, minutes: number): Promise<void> {
  const session = await getValidSession()
  const db = client(session.access_token)

  const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  const { error } = await db
    .from('task_reminders')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', id)

  if (error) throw new Error(`snoozeReminder: ${error.message}`)
}

export async function fireReminder(id: string, recurrenceType: string, remindAt: string, recurrenceEndAt: string | null): Promise<void> {
  const session = await getValidSession()
  const db = client(session.access_token)

  const now = new Date().toISOString()

  if (recurrenceType === 'none') {
    await db.from('task_reminders').update({ last_fired_at: now }).eq('id', id)
    return
  }

  const next = getNextOccurrence(recurrenceType, remindAt)
  if (!next || (recurrenceEndAt && next > new Date(recurrenceEndAt))) {
    // Recurrence ended — mark as fired only
    await db.from('task_reminders').update({ last_fired_at: now }).eq('id', id)
    return
  }

  await db.from('task_reminders').update({
    last_fired_at: now,
    remind_at: next.toISOString(),
    snoozed_until: null,
  }).eq('id', id)
}

function getNextOccurrence(recurrenceType: string, remindAt: string): Date | null {
  const base = new Date(remindAt)
  switch (recurrenceType) {
    case 'daily':
      base.setDate(base.getDate() + 1)
      break
    case 'weekdays':
      base.setDate(base.getDate() + 1)
      while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1)
      break
    case 'weekly':
      base.setDate(base.getDate() + 7)
      break
    case 'monthly':
      base.setMonth(base.getMonth() + 1)
      break
    case 'yearly':
      base.setFullYear(base.getFullYear() + 1)
      break
    default:
      return null
  }
  return base
}
