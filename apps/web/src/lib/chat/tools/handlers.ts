import { createServiceClient } from '@/lib/supabase/server'
import type { ToolName, TaskPriority, TaskStatus, RecurrenceType } from '@personal-assistant/types'
import type { Database } from '@/types/supabase'
import { assembleBriefing } from '@/lib/jobs/briefing'

type GoalStatus = Database['public']['Enums']['goal_status']
type GoalConfidence = Database['public']['Enums']['goal_confidence']
type GoalMomentum = Database['public']['Enums']['goal_momentum']
import {
  handleSaveMemory,
  handleRecallMemories,
  handleUpsertEntity,
  handleUpdateUserContext,
  handleSummarizeConversation,
} from '@/lib/memory/tools'

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

async function handleCreateGoal(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('goals')
      .insert({
        user_id: userId,
        title: String(input.title ?? '').trim(),
        life_area_id: input.life_area_id ? String(input.life_area_id) : null,
        why_it_matters: input.why_it_matters ? String(input.why_it_matters) : null,
        success_metrics: input.success_metrics ? String(input.success_metrics) : null,
        status: (input.status ?? 'active') as GoalStatus,
        confidence: (input.confidence ?? 'medium') as GoalConfidence,
      })
      .select()
      .single()

    if (error) {
      console.error('[handleCreateGoal] create_goal failed', { userId, error })
      return { content: 'Failed to create goal. Please try again.', is_error: true }
    }
    return { content: JSON.stringify(data), is_error: false }
  } catch (err) {
    console.error('[handleCreateGoal] create_goal unexpected error', { userId, err })
    return { content: 'Failed to create goal. Please try again.', is_error: true }
  }
}

async function handleUpdateGoal(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const db = createServiceClient()

    type GoalUpdate = {
      title?: string
      why_it_matters?: string | null
      success_metrics?: string | null
      status?: GoalStatus
      confidence?: GoalConfidence
      life_area_id?: string | null
    }

    const updates: GoalUpdate = {}
    if ('title' in input) updates.title = String(input.title)
    if ('why_it_matters' in input) updates.why_it_matters = input.why_it_matters ? String(input.why_it_matters) : null
    if ('success_metrics' in input) updates.success_metrics = input.success_metrics ? String(input.success_metrics) : null
    if ('status' in input) updates.status = input.status as GoalStatus
    if ('confidence' in input) updates.confidence = input.confidence as GoalConfidence
    if ('life_area_id' in input) updates.life_area_id = input.life_area_id ? String(input.life_area_id) : null

    const { data, error } = await db
      .from('goals')
      .update(updates)
      .eq('id', String(input.id))
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      console.error('[handleUpdateGoal] update_goal failed', { userId, error })
      return { content: 'Failed to update goal. Please try again.', is_error: true }
    }
    return { content: JSON.stringify(data), is_error: false }
  } catch (err) {
    console.error('[handleUpdateGoal] update_goal unexpected error', { userId, err })
    return { content: 'Failed to update goal. Please try again.', is_error: true }
  }
}

async function handleListGoals(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const db = createServiceClient()
    let query = db
      .from('goals')
      .select('*, projects(count)')
      .eq('user_id', userId)

    if (input.life_area_id) query = query.eq('life_area_id', String(input.life_area_id))
    if (input.status) query = query.eq('status', input.status as GoalStatus)
    query = query.order('created_at', { ascending: false }).limit(Number(input.limit ?? 20))

    const { data, error } = await query
    if (error) {
      console.error('[handleListGoals] list_goals failed', { userId, error })
      return { content: 'Failed to list goals. Please try again.', is_error: true }
    }
    return { content: JSON.stringify(data), is_error: false }
  } catch (err) {
    console.error('[handleListGoals] list_goals unexpected error', { userId, err })
    return { content: 'Failed to list goals. Please try again.', is_error: true }
  }
}

async function handleSetGoalMomentum(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('goals')
      .update({ momentum: input.momentum as GoalMomentum })
      .eq('id', String(input.id))
      .eq('user_id', userId)
      .select('id, title, momentum')
      .single()

    if (error) {
      console.error('[handleSetGoalMomentum] set_goal_momentum failed', { userId, error })
      return { content: 'Failed to set goal momentum. Please try again.', is_error: true }
    }
    return { content: JSON.stringify(data), is_error: false }
  } catch (err) {
    console.error('[handleSetGoalMomentum] set_goal_momentum unexpected error', { userId, err })
    return { content: 'Failed to set goal momentum. Please try again.', is_error: true }
  }
}

async function handleCreateProject(input: Input, userId: string): Promise<HandlerResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('projects')
      .insert({
        user_id: userId,
        title: String(input.title ?? '').trim(),
        goal_id: String(input.goal_id),
        description: input.description ? String(input.description) : null,
        status: (input.status ?? 'pending') as TaskStatus,
      })
      .select()
      .single()

    if (error) {
      console.error('[handleCreateProject] create_project failed', { userId, error })
      return { content: 'Failed to create project. Please try again.', is_error: true }
    }
    return { content: JSON.stringify(data), is_error: false }
  } catch (err) {
    console.error('[handleCreateProject] create_project unexpected error', { userId, err })
    return { content: 'Failed to create project. Please try again.', is_error: true }
  }
}

async function handleGenerateDailyBriefing(_input: Input, userId: string): Promise<HandlerResult> {
  try {
    const briefing = await assembleBriefing(userId)
    console.log(JSON.stringify({ event: 'generate_daily_briefing', userId }))
    return { content: JSON.stringify(briefing), is_error: false }
  } catch (err) {
    console.error('[handleGenerateDailyBriefing] generate_daily_briefing unexpected error', { userId, err })
    return { content: 'Failed to generate briefing. Please try again.', is_error: true }
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
  create_goal: handleCreateGoal,
  update_goal: handleUpdateGoal,
  list_goals: handleListGoals,
  set_goal_momentum: handleSetGoalMomentum,
  create_project: handleCreateProject,
  generate_daily_briefing: handleGenerateDailyBriefing,
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
