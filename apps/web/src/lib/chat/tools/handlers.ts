import { createServiceClient } from '@/lib/supabase/server'
import type { ToolName, TaskPriority, TaskStatus, RecurrenceType } from '@personal-assistant/types'
import {
  handleSaveMemory,
  handleRecallMemories,
  handleUpsertEntity,
  handleUpdateUserContext,
  handleSummarizeConversation,
} from '@/lib/memory/tools'
import { validatePayload } from '@/lib/approvals/payload-validator'
import { writeAudit } from '@/lib/approvals/audit'

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

async function memResult(fn: Promise<string>): Promise<HandlerResult> {
  const content = await fn
  return { content, is_error: false }
}

async function handleAddConstraint(input: Input, userId: string): Promise<HandlerResult> {
  const rule = String(input.rule ?? '').trim()
  const rationale = String(input.rationale ?? '').trim()

  if (!rationale) {
    return {
      content: 'rationale is required — please state why this rule exists before saving it.',
      is_error: true,
    }
  }
  if (!rule) {
    return { content: 'rule is required.', is_error: true }
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('behavioral_constraints')
    .insert({
      user_id: userId,
      rule,
      rationale,
      scope: String(input.scope ?? 'all').trim() || 'all',
      is_locked: Boolean(input.is_locked ?? false),
    })
    .select('id, rule, scope, is_locked')
    .single()

  if (error) {
    console.error(JSON.stringify({ event: 'constraint_add_error', userId, error: error.message }))
    return { content: `Failed to save constraint: ${error.message}`, is_error: true }
  }

  console.log(JSON.stringify({ event: 'constraint_added', userId, scope: data.scope, isLocked: data.is_locked }))
  return {
    content: `Constraint saved: "${data.rule}" (scope: ${data.scope}, locked: ${data.is_locked}).`,
    is_error: false,
  }
}

async function handleListConstraints(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const scope = input.scope ? String(input.scope).trim() : undefined

  let query = db
    .from('behavioral_constraints')
    .select('id, rule, rationale, scope, is_locked, created_at')
    .eq('user_id', userId)
    .order('is_locked', { ascending: false })
    .order('created_at', { ascending: false })

  if (scope) {
    query = query.in('scope', [scope, 'all'])
  }

  const { data, error } = await query

  if (error) {
    console.error(JSON.stringify({ event: 'constraint_list_error', userId, error: error.message }))
    return { content: `Failed to list constraints: ${error.message}`, is_error: true }
  }

  return { content: JSON.stringify(data ?? []), is_error: false }
}

async function handleSubmitForApproval(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const actionType = String(input.action_type ?? '').trim()
    const provider = String(input.provider ?? '').trim()
    const payload = input.payload
    const aiSummary = input.ai_summary ? String(input.ai_summary).trim() : null

    // Validate action type and payload shape before any DB write
    const validation = validatePayload(actionType, payload)
    if (!validation.valid) {
      console.error('[handleSubmitForApproval] payload validation failed', { userId, actionType, errors: validation.errors })
      return {
        content: `Proposal rejected — validation failed: ${validation.errors.join('; ')}`,
        is_error: true,
      }
    }

    const db = createServiceClient()
    const { data, error } = await db
      .from('approval_queue')
      .insert({
        user_id: userId,
        action_type: actionType,
        provider,
        payload: payload as import('@/types/supabase').Json,
        ai_summary: aiSummary,
        status: 'pending',
      })
      .select('id, action_type, provider, status, created_at')
      .single()

    if (error) {
      console.error('[handleSubmitForApproval] insert failed', { userId, actionType, error: error.message })
      return { content: 'Failed to queue the proposed action. Please try again.', is_error: true }
    }

    // Write 'proposed' audit entry; non-blocking — failure does not abort the submission
    void writeAudit({
      userId,
      approvalId: data.id,
      actionType,
      provider,
      status: 'proposed',
      delegation: {
        user: userId,
        actor: 'coriven',
        connection: { provider, nango_connection_id: null },
      },
    })

    console.log(JSON.stringify({ event: 'approval_proposed', userId, approvalId: data.id, actionType, provider }))

    return {
      content: JSON.stringify({
        approval_id: data.id,
        status: 'pending',
        message: `Action queued for your review. Visit /approvals to approve, modify, or cancel.`,
        action_type: data.action_type,
        provider: data.provider,
        created_at: data.created_at,
      }),
      is_error: false,
    }
  } catch (err) {
    console.error('[handleSubmitForApproval] unexpected error', { userId, err })
    return { content: 'Failed to queue the proposed action. Please try again.', is_error: true }
  }
}

const HANDLERS: Record<ToolName, (input: Input, userId: string) => Promise<HandlerResult>> = {
  create_task: handleCreateTask,
  update_task: handleUpdateTask,
  list_tasks: handleListTasks,
  add_reminder: handleAddReminder,
  remove_reminder: handleRemoveReminder,
  snooze_reminder: handleSnoozeReminder,
  delete_task: handleDeleteTask,
  save_memory: (input, userId) => memResult(handleSaveMemory(userId, input as never)),
  recall_memories: (input, userId) => memResult(handleRecallMemories(userId, input as never)),
  upsert_entity: (input, userId) => memResult(handleUpsertEntity(userId, input as never)),
  update_user_context: (input, userId) => memResult(handleUpdateUserContext(userId, input as never)),
  summarize_conversation: (input, userId) => memResult(handleSummarizeConversation(userId, input as never)),
  add_constraint: handleAddConstraint,
  list_constraints: handleListConstraints,
  submit_for_approval: handleSubmitForApproval,
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
