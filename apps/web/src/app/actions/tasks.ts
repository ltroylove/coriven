'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import type { CreateTaskInput, UpdateTaskInput, TaskStatus, CreateReminderInput, UpdateReminderInput } from '@personal-assistant/types'

async function getAuthenticatedUser() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function getTask(id: string) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { data, error } = await service
    .from('tasks')
    .select('*, reminders:task_reminders(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .order('remind_at', { referencedTable: 'task_reminders', ascending: true })
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getTasks(status?: TaskStatus) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  let query = service
    .from('tasks')
    .select('*, reminders:task_reminders(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('remind_at', { referencedTable: 'task_reminders', ascending: true })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

export async function createTask(input: CreateTaskInput) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { data, error } = await service
    .from('tasks')
    .insert({
      user_id: user.id,
      title: input.title.trim(),
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      due_at: input.due_at ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  if (input.reminders?.length) {
    const rows = input.reminders.map(r => ({
      task_id: data.id,
      user_id: user.id,
      remind_at: r.remind_at,
      recurrence_type: r.recurrence_type ?? 'none' as const,
      recurrence_end_at: r.recurrence_end_at ?? null,
    }))
    const { error: rErr } = await service.from('task_reminders').insert(rows)
    if (rErr) throw new Error(rErr.message)
  }

  revalidatePath('/tasks')
  return data
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const completedAt =
    input.status === 'done' ? new Date().toISOString()
    : input.status ? null
    : undefined

  const { data, error } = await service
    .from('tasks')
    .update({
      ...input,
      ...(completedAt !== undefined && { completed_at: completedAt }),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  return data
}

export async function deleteTask(id: string) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { error } = await service
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
}

// --- Reminder actions ---

export async function addReminder(taskId: string, input: CreateReminderInput) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { data, error } = await service
    .from('task_reminders')
    .insert({
      task_id: taskId,
      user_id: user.id,
      remind_at: input.remind_at,
      recurrence_type: input.recurrence_type ?? 'none',
      recurrence_end_at: input.recurrence_end_at ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  return data
}

export async function updateReminder(id: string, input: UpdateReminderInput) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { data, error } = await service
    .from('task_reminders')
    .update(input)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  return data
}

export async function deleteReminder(id: string) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const { error } = await service
    .from('task_reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
}

export async function snoozeReminder(id: string, minutes: number) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()

  const { data, error } = await service
    .from('task_reminders')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  return data
}
