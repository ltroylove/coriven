import { createServiceClient } from '@/lib/supabase/server'
import type { ToolName, TaskPriority, TaskStatus, RecurrenceType } from '@personal-assistant/types'

type HandlerResult = { content: string; is_error: boolean }
type Input = Record<string, unknown>

async function handleCreateTask(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('tasks')
    .insert({
      user_id: userId,
      title: String(input.title ?? '').trim(),
      description: input.description ? String(input.description) : null,
      priority: (input.priority ?? 'medium') as TaskPriority,
      due_at: input.due_at ? String(input.due_at) : null,
    })
    .select()
    .single()

  if (error) return { content: `Failed to create task: ${error.message}`, is_error: true }

  const reminders = Array.isArray(input.reminders) ? input.reminders as Array<{ remind_at: string; recurrence_type?: string; recurrence_end_at?: string }> : []
  if (reminders.length > 0) {
    const rows = reminders.map(r => ({
      task_id: data.id,
      user_id: userId,
      remind_at: r.remind_at,
      recurrence_type: (r.recurrence_type ?? 'none') as RecurrenceType,
      recurrence_end_at: r.recurrence_end_at ?? null,
    }))
    const { error: rErr } = await db.from('task_reminders').insert(rows)
    if (rErr) return { content: `Task created but failed to add reminders: ${rErr.message}`, is_error: true }
  }

  const { data: withReminders } = await db
    .from('tasks')
    .select('*, reminders:task_reminders(*)')
    .eq('id', data.id)
    .single()

  return { content: JSON.stringify(withReminders ?? data), is_error: false }
}

async function handleUpdateTask(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()

  type TaskUpdate = {
    title?: string
    description?: string | null
    priority?: TaskPriority
    status?: TaskStatus
    completed_at?: string | null
    due_at?: string | null
  }

  const updates: TaskUpdate = {}
  if ('title' in input) updates.title = String(input.title)
  if ('description' in input) updates.description = input.description ? String(input.description) : null
  if ('priority' in input) updates.priority = input.priority as TaskPriority
  if ('status' in input) {
    updates.status = input.status as TaskStatus
    if (input.status === 'done') updates.completed_at = new Date().toISOString()
  }
  if ('due_at' in input) updates.due_at = input.due_at ? String(input.due_at) : null

  const { data, error } = await db
    .from('tasks')
    .update(updates)
    .eq('id', String(input.id))
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return { content: `Failed to update task: ${error.message}`, is_error: true }
  return { content: JSON.stringify(data), is_error: false }
}

async function handleListTasks(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  let query = db
    .from('tasks')
    .select('*, reminders:task_reminders(*)')
    .eq('user_id', userId)

  if (input.status) query = query.eq('status', input.status as TaskStatus)
  if (input.priority) query = query.eq('priority', input.priority as TaskPriority)
  query = query.order('created_at', { ascending: false }).limit(Number(input.limit ?? 20))

  const { data, error } = await query
  if (error) return { content: `Failed to list tasks: ${error.message}`, is_error: true }
  return { content: JSON.stringify(data), is_error: false }
}

async function handleAddReminder(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('task_reminders')
    .insert({
      task_id: String(input.task_id),
      user_id: userId,
      remind_at: String(input.remind_at),
      recurrence_type: (input.recurrence_type ?? 'none') as RecurrenceType,
      recurrence_end_at: input.recurrence_end_at ? String(input.recurrence_end_at) : null,
    })
    .select()
    .single()

  if (error) return { content: `Failed to add reminder: ${error.message}`, is_error: true }
  return { content: JSON.stringify(data), is_error: false }
}

async function handleRemoveReminder(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const { error } = await db
    .from('task_reminders')
    .delete()
    .eq('id', String(input.reminder_id))
    .eq('user_id', userId)

  if (error) return { content: `Failed to remove reminder: ${error.message}`, is_error: true }
  return { content: `Reminder ${String(input.reminder_id)} removed`, is_error: false }
}

async function handleSnoozeReminder(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const snoozedUntil = new Date(Date.now() + Number(input.minutes) * 60 * 1000).toISOString()

  const { error } = await db
    .from('task_reminders')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', String(input.reminder_id))
    .eq('user_id', userId)

  if (error) return { content: `Failed to snooze reminder: ${error.message}`, is_error: true }
  return { content: `Reminder snoozed until ${snoozedUntil}`, is_error: false }
}

async function handleDeleteTask(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const { error } = await db
    .from('tasks')
    .delete()
    .eq('id', String(input.id))
    .eq('user_id', userId)

  if (error) return { content: `Failed to delete task: ${error.message}`, is_error: true }
  return { content: `Task ${String(input.id)} deleted`, is_error: false }
}

async function handleNotImplemented(_input: Input, _userId: string): Promise<HandlerResult> {
  return { content: 'This memory tool is not yet implemented', is_error: true }
}

const HANDLERS: Record<ToolName, (input: Input, userId: string) => Promise<HandlerResult>> = {
  create_task: handleCreateTask,
  update_task: handleUpdateTask,
  list_tasks: handleListTasks,
  add_reminder: handleAddReminder,
  remove_reminder: handleRemoveReminder,
  snooze_reminder: handleSnoozeReminder,
  delete_task: handleDeleteTask,
  save_memory: handleNotImplemented,
  recall_memories: handleNotImplemented,
  upsert_entity: handleNotImplemented,
  update_user_context: handleNotImplemented,
  summarize_conversation: handleNotImplemented,
}

export async function executeToolHandler(
  toolName: string,
  input: Input,
  userId: string,
): Promise<HandlerResult> {
  const handler = HANDLERS[toolName as ToolName]
  if (!handler) return { content: `Unknown tool: ${toolName}`, is_error: true }
  try {
    return await handler(input, userId)
  } catch (err) {
    return { content: `Tool error: ${String(err)}`, is_error: true }
  }
}
