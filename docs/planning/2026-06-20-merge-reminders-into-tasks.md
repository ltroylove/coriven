# Merge Reminders Into Tasks — Implementation Plan

**Goal:** Fold the reminders concept into tasks — a task can optionally have a scheduled notification time, recurrence, and snooze — removing the separate reminders table, routes, pages, and tools.

**Architecture:** Add `remind_at`, `snoozed_until`, `recurrence_type`, `recurrence_end_at`, and `last_fired_at` columns to `tasks`. Drop the `reminders` table. Delete all reminder-specific code and replace with unified task handling. The tray daemon polls `/api/tasks/due` instead of `/api/reminders/due`.

**Tech Stack:** Supabase migration (SQL), TypeScript types package, Next.js server actions, API routes, React components, Claude tool registry.

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260620_merge_reminders_into_tasks.sql`

- [ ] Create the migration file:

```sql
-- Add reminder fields to tasks
ALTER TABLE tasks
  ADD COLUMN remind_at         timestamptz,
  ADD COLUMN snoozed_until     timestamptz,
  ADD COLUMN recurrence_type   recurrence_type NOT NULL DEFAULT 'none',
  ADD COLUMN recurrence_end_at timestamptz,
  ADD COLUMN last_fired_at     timestamptz;

CREATE INDEX tasks_remind_at_idx
  ON tasks (user_id, remind_at)
  WHERE remind_at IS NOT NULL;

-- Drop reminders table (no data worth migrating)
DROP TABLE IF EXISTS reminders;
```

- [ ] Apply the migration:

```bash
npx supabase migration up
```

Expected output: `Applying migration 20260620_merge_reminders_into_tasks.sql... Local database is up to date.`

- [ ] Regenerate Supabase TypeScript types:

```powershell
cd C:\Projects\Personal-Assistant
npx supabase gen types typescript --local 2>$null | Out-File -FilePath apps/web/src/types/supabase.ts -Encoding utf8
```

- [ ] Commit:

```bash
git add supabase/migrations/20260620_merge_reminders_into_tasks.sql apps/web/src/types/supabase.ts
git commit -m "feat: migrate reminder fields into tasks table, drop reminders"
```

---

### Task 2: Update Shared Types Package

**Files:**
- Modify: `packages/types/src/task.ts`
- Delete: `packages/types/src/reminder.ts`
- Modify: `packages/types/src/tool.ts`
- Modify: `packages/types/src/index.ts`

- [ ] Replace `packages/types/src/task.ts` with:

```typescript
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type RecurrenceType = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'

export interface Task {
  id: string
  user_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  completed_at: string | null
  remind_at: string | null
  snoozed_until: string | null
  recurrence_type: RecurrenceType
  recurrence_end_at: string | null
  last_fired_at: string | null
  created_at: string
  updated_at: string
}

export type CreateTaskInput = Pick<Task, 'title'> &
  Partial<Pick<Task, 'description' | 'priority' | 'due_at' | 'remind_at' | 'recurrence_type' | 'recurrence_end_at'>>

export type UpdateTaskInput = Partial<
  Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_at' | 'remind_at' | 'snoozed_until' | 'recurrence_type' | 'recurrence_end_at'>
>

export function getNextOccurrence(task: Pick<Task, 'remind_at' | 'recurrence_type' | 'recurrence_end_at'>): Date | null {
  if (!task.remind_at || task.recurrence_type === 'none') return null

  const next = new Date(task.remind_at)

  switch (task.recurrence_type) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      break
    case 'weekdays':
      next.setDate(next.getDate() + 1)
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1)
      }
      break
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1)
      break
  }

  if (task.recurrence_end_at && next > new Date(task.recurrence_end_at)) return null
  return next
}
```

- [ ] Replace `packages/types/src/tool.ts` with:

```typescript
export type ToolName =
  | 'create_task'
  | 'update_task'
  | 'list_tasks'
  | 'snooze_task'
  | 'delete_task'

export interface ToolPermission {
  id: string
  user_id: string
  tool_name: ToolName
  enabled: boolean
  granted_at: string
}

export interface ToolDefinition {
  name: ToolName
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
```

- [ ] Replace `packages/types/src/index.ts` with:

```typescript
export * from './task'
export * from './tool'
export * from './conversation'
```

- [ ] Delete `packages/types/src/reminder.ts`.

- [ ] Typecheck the types package:

```bash
cd packages/types && npx tsc --noEmit
```

Expected: no errors.

- [ ] Commit:

```bash
git add packages/types/src/
git commit -m "feat: merge RecurrenceType into Task type, remove Reminder type"
```

---

### Task 3: Update Server Actions

**Files:**
- Modify: `apps/web/src/app/actions/tasks.ts`
- Delete: `apps/web/src/app/actions/reminders.ts`

- [ ] Replace `apps/web/src/app/actions/tasks.ts` with:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import type { CreateTaskInput, UpdateTaskInput, TaskStatus } from '@personal-assistant/types'

async function getAuthenticatedUser() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function getTasks(status?: TaskStatus) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  let query = service
    .from('tasks')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

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
      remind_at: input.remind_at ?? null,
      recurrence_type: input.recurrence_type ?? 'none',
      recurrence_end_at: input.recurrence_end_at ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
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

export async function snoozeTask(id: string, minutes: number) {
  const user = await getAuthenticatedUser()
  const service = createServiceClient()

  const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()

  const { data, error } = await service
    .from('tasks')
    .update({ snoozed_until: snoozedUntil })
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
```

- [ ] Delete `apps/web/src/app/actions/reminders.ts`.

- [ ] Commit:

```bash
git add apps/web/src/app/actions/tasks.ts
git rm apps/web/src/app/actions/reminders.ts
git commit -m "feat: add snoozeTask action, remove reminders actions"
```

---

### Task 4: Update API Routes

**Files:**
- Create: `apps/web/src/app/api/tasks/due/route.ts`
- Create: `apps/web/src/app/api/tasks/[id]/snooze/route.ts`
- Delete: `apps/web/src/app/api/reminders/` (entire directory)

- [ ] Create `apps/web/src/app/api/tasks/due/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  const service = createServiceClient()
  const { data, error } = await service
    .from('tasks')
    .select('*')
    .eq('user_id', user.id)
    .not('remind_at', 'is', null)
    .lte('remind_at', in24h)
    .not('status', 'in', '("done","cancelled")')
    .or(`last_fired_at.is.null,last_fired_at.lt.remind_at`)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('remind_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] Create `apps/web/src/app/api/tasks/[id]/snooze/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { minutes } = await request.json() as { minutes: number }
  if (!minutes || minutes < 1) {
    return NextResponse.json({ error: 'minutes must be a positive number' }, { status: 400 })
  }

  const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  const service = createServiceClient()
  const { data, error } = await service
    .from('tasks')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] Delete the reminders API directory:

```bash
git rm -r apps/web/src/app/api/reminders/
```

- [ ] Commit:

```bash
git add apps/web/src/app/api/tasks/
git commit -m "feat: add /api/tasks/due and /api/tasks/[id]/snooze, remove /api/reminders"
```

---

### Task 5: Update Claude Tool Registry and Handlers

**Files:**
- Modify: `apps/web/src/lib/chat/tools/registry.ts`
- Modify: `apps/web/src/lib/chat/tools/handlers.ts`

- [ ] Replace `apps/web/src/lib/chat/tools/registry.ts` with:

```typescript
import type Anthropic from '@anthropic-ai/sdk'
import type { ToolName } from '@personal-assistant/types'

export const ALL_TOOL_NAMES: ToolName[] = [
  'create_task',
  'update_task',
  'list_tasks',
  'snooze_task',
  'delete_task',
]

export const TOOL_REGISTRY: Record<ToolName, Anthropic.Tool> = {
  create_task: {
    name: 'create_task',
    description: 'Create a new task. Use for todos, reminders, or anything the user wants to track or be notified about.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, clear task title' },
        description: { type: 'string', description: 'Optional longer description' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Task priority. Default: medium',
        },
        due_at: {
          type: 'string',
          description: 'Deadline as ISO 8601, e.g. "2026-06-20T17:00:00". Omit if no deadline.',
        },
        remind_at: {
          type: 'string',
          description: 'When to notify the user as ISO 8601, e.g. "2026-06-20T09:00:00". Use when the user says "remind me" or specifies a time.',
        },
        recurrence_type: {
          type: 'string',
          enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'],
          description: 'How often to repeat the reminder. Default: none',
        },
        recurrence_end_at: {
          type: 'string',
          description: 'When to stop recurring, as ISO 8601. Optional.',
        },
      },
      required: ['title'],
    },
  },

  update_task: {
    name: 'update_task',
    description: 'Update an existing task. Use after list_tasks to get the task ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (UUID)' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
        due_at: { type: 'string', description: 'ISO 8601 datetime or null to clear' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime or null to clear the reminder' },
        recurrence_type: {
          type: 'string',
          enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'],
        },
      },
      required: ['id'],
    },
  },

  list_tasks: {
    name: 'list_tasks',
    description: "List the user's tasks. Use before updating or referencing a task by ID.",
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'cancelled'],
          description: 'Filter by status. Omit to return all.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
        limit: { type: 'number', description: 'Max results. Default: 20' },
      },
      required: [],
    },
  },

  snooze_task: {
    name: 'snooze_task',
    description: 'Snooze a task reminder by pushing back the remind_at time.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (UUID)' },
        minutes: { type: 'number', description: 'Minutes to snooze, e.g. 30, 60, 1440 (1 day)' },
      },
      required: ['id', 'minutes'],
    },
  },

  delete_task: {
    name: 'delete_task',
    description: 'Permanently delete a task.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (UUID)' },
      },
      required: ['id'],
    },
  },
}
```

- [ ] Replace `apps/web/src/lib/chat/tools/handlers.ts` with:

```typescript
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
      remind_at: input.remind_at ? String(input.remind_at) : null,
      recurrence_type: (input.recurrence_type ?? 'none') as RecurrenceType,
      recurrence_end_at: input.recurrence_end_at ? String(input.recurrence_end_at) : null,
    })
    .select()
    .single()

  if (error) return { content: `Failed to create task: ${error.message}`, is_error: true }
  return { content: JSON.stringify(data), is_error: false }
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
    remind_at?: string | null
    recurrence_type?: RecurrenceType
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
  if ('remind_at' in input) updates.remind_at = input.remind_at ? String(input.remind_at) : null
  if ('recurrence_type' in input) updates.recurrence_type = input.recurrence_type as RecurrenceType

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
  let query = db.from('tasks').select('*').eq('user_id', userId)

  if (input.status) query = query.eq('status', input.status as TaskStatus)
  if (input.priority) query = query.eq('priority', input.priority as TaskPriority)
  query = query.order('created_at', { ascending: false }).limit(Number(input.limit ?? 20))

  const { data, error } = await query
  if (error) return { content: `Failed to list tasks: ${error.message}`, is_error: true }
  return { content: JSON.stringify(data), is_error: false }
}

async function handleSnoozeTask(input: Input, userId: string): Promise<HandlerResult> {
  const db = createServiceClient()
  const snoozedUntil = new Date(Date.now() + Number(input.minutes) * 60 * 1000).toISOString()

  const { error } = await db
    .from('tasks')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', String(input.id))
    .eq('user_id', userId)

  if (error) return { content: `Failed to snooze task: ${error.message}`, is_error: true }
  return { content: `Task snoozed until ${snoozedUntil}`, is_error: false }
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

const HANDLERS: Record<ToolName, (input: Input, userId: string) => Promise<HandlerResult>> = {
  create_task: handleCreateTask,
  update_task: handleUpdateTask,
  list_tasks: handleListTasks,
  snooze_task: handleSnoozeTask,
  delete_task: handleDeleteTask,
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
```

- [ ] Commit:

```bash
git add apps/web/src/lib/chat/tools/
git commit -m "feat: replace reminder tools with snooze_task/delete_task, add remind_at to create_task"
```

---

### Task 6: Update TaskCard to Show Reminder Fields

**Files:**
- Modify: `apps/web/src/components/tasks/task-card.tsx`

- [ ] Replace `apps/web/src/components/tasks/task-card.tsx` with:

```typescript
'use client'

import { useTransition } from 'react'
import { CheckCircle, Circle, Trash2, Clock, Bell, Repeat } from 'lucide-react'
import { updateTask, deleteTask, snoozeTask } from '@/app/actions/tasks'
import type { Task } from '@personal-assistant/types'

const priorityColors = {
  low: 'text-gray-400 bg-gray-800',
  medium: 'text-blue-400 bg-blue-950',
  high: 'text-orange-400 bg-orange-950',
  urgent: 'text-red-400 bg-red-950',
}

const statusColors = {
  pending: 'text-white',
  in_progress: 'text-blue-300',
  done: 'text-gray-500 line-through',
  cancelled: 'text-gray-600 line-through',
}

const recurrenceLabels: Record<string, string> = {
  daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly',
  monthly: 'Monthly', yearly: 'Yearly',
}

const SNOOZE_OPTIONS = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '1d', minutes: 1440 },
]

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function TaskCard({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const [isPending, startTransition] = useTransition()
  const isDone = task.status === 'done'
  const hasReminder = !!task.remind_at
  const isSnoozed = task.snoozed_until && new Date(task.snoozed_until) > new Date()
  const reminderPast = hasReminder && new Date(task.remind_at!) <= new Date() && !isSnoozed

  function toggleDone() {
    startTransition(async () => {
      await updateTask(task.id, { status: isDone ? 'pending' : 'done' })
    })
  }

  function handleDelete() {
    if (!confirm('Delete this task?')) return
    startTransition(() => deleteTask(task.id))
  }

  function handleSnooze(minutes: number) {
    startTransition(async () => {
      await snoozeTask(task.id, minutes)
    })
  }

  return (
    <div className={`flex items-start gap-3 p-4 bg-gray-900 border rounded-lg group transition-opacity
      ${isPending ? 'opacity-50' : ''}
      ${reminderPast ? 'border-orange-800/60' : 'border-gray-800'}`}>
      <button onClick={toggleDone} className="mt-0.5 shrink-0 text-gray-500 hover:text-green-400 transition-colors">
        {isDone
          ? <CheckCircle className="w-5 h-5 text-green-500" />
          : <Circle className="w-5 h-5" />}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium truncate cursor-pointer ${statusColors[task.status]}`}
          onClick={() => onEdit(task)}
        >
          {task.title}
        </p>

        {task.description && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityColors[task.priority]}`}>
            {task.priority}
          </span>

          {task.due_at && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              {new Date(task.due_at).toLocaleDateString()}
            </span>
          )}

          {hasReminder && (
            <span className={`flex items-center gap-1 text-xs ${reminderPast ? 'text-orange-400' : 'text-blue-400'}`}>
              <Bell className="w-3 h-3" />
              {formatDateTime(task.remind_at!)}
            </span>
          )}

          {task.recurrence_type !== 'none' && (
            <span className="flex items-center gap-1 text-xs text-purple-400">
              <Repeat className="w-3 h-3" />
              {recurrenceLabels[task.recurrence_type]}
            </span>
          )}

          {isSnoozed && (
            <span className="text-xs text-yellow-400">
              Snoozed until {formatDateTime(task.snoozed_until!)}
            </span>
          )}
        </div>

        {hasReminder && !isDone && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-xs text-gray-600">Snooze:</span>
            {SNOOZE_OPTIONS.map(opt => (
              <button
                key={opt.minutes}
                onClick={() => handleSnooze(opt.minutes)}
                className="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleDelete}
        className="shrink-0 text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add apps/web/src/components/tasks/task-card.tsx
git commit -m "feat: show remind_at, recurrence, snooze buttons on TaskCard"
```

---

### Task 7: Update TaskForm to Include Reminder Fields

**Files:**
- Modify: `apps/web/src/components/tasks/task-form.tsx`

- [ ] Replace `apps/web/src/components/tasks/task-form.tsx` with:

```typescript
'use client'

import { useState, useTransition, useEffect } from 'react'
import { X } from 'lucide-react'
import { createTask, updateTask } from '@/app/actions/tasks'
import type { Task, TaskPriority, TaskStatus, RecurrenceType } from '@personal-assistant/types'

type Props = {
  task?: Task | null
  onClose: () => void
}

export function TaskForm({ task, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'pending')
  const [dueAt, setDueAt] = useState(task?.due_at ? task.due_at.slice(0, 16) : '')
  const [remindAt, setRemindAt] = useState(task?.remind_at ? task.remind_at.slice(0, 16) : '')
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(task?.recurrence_type ?? 'none')
  const [recurrenceEndAt, setRecurrenceEndAt] = useState(task?.recurrence_end_at ? task.recurrence_end_at.slice(0, 16) : '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setPriority(task?.priority ?? 'medium')
    setStatus(task?.status ?? 'pending')
    setDueAt(task?.due_at ? task.due_at.slice(0, 16) : '')
    setRemindAt(task?.remind_at ? task.remind_at.slice(0, 16) : '')
    setRecurrenceType(task?.recurrence_type ?? 'none')
    setRecurrenceEndAt(task?.recurrence_end_at ? task.recurrence_end_at.slice(0, 16) : '')
    setError(null)
  }, [task])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setError(null)

    startTransition(async () => {
      try {
        const reminder = remindAt
          ? {
              remind_at: new Date(remindAt).toISOString(),
              recurrence_type: recurrenceType,
              recurrence_end_at: recurrenceType !== 'none' && recurrenceEndAt
                ? new Date(recurrenceEndAt).toISOString()
                : undefined,
            }
          : { remind_at: undefined, recurrence_type: 'none' as RecurrenceType }

        if (task) {
          await updateTask(task.id, {
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            status,
            due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
            ...reminder,
          })
        } else {
          await createTask({
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
            ...reminder,
          })
        }
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">{task ? 'Edit task' : 'New task'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional details..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as TaskPriority)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            {task && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as TaskStatus)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Due date</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="border-t border-gray-800 pt-4">
            <label className="block text-xs font-medium text-gray-400 mb-1">Remind me at</label>
            <input
              type="datetime-local"
              value={remindAt}
              onChange={e => setRemindAt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {remindAt && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Repeat</label>
                <select
                  value={recurrenceType}
                  onChange={e => setRecurrenceType(e.target.value as RecurrenceType)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays (Mon–Fri)</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {recurrenceType !== 'none' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Repeat ends <span className="text-gray-600">(optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={recurrenceEndAt}
                    onChange={e => setRecurrenceEndAt(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isPending ? 'Saving...' : task ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add apps/web/src/components/tasks/task-form.tsx
git commit -m "feat: add remind_at and recurrence fields to TaskForm"
```

---

### Task 8: Remove Reminders Page and Update Nav

**Files:**
- Delete: `apps/web/src/app/(app)/reminders/` (entire directory)
- Delete: `apps/web/src/components/reminders/` (entire directory)
- Modify: `apps/web/src/app/(app)/layout.tsx`

- [ ] Delete reminders UI:

```bash
git rm -r apps/web/src/app/(app)/reminders/
git rm -r apps/web/src/components/reminders/
```

- [ ] Remove "Reminders" from the nav in `apps/web/src/app/(app)/layout.tsx`. Change the nav links section from:

```typescript
<a href="/tasks" className="text-gray-400 hover:text-white transition-colors">Tasks</a>
<a href="/reminders" className="text-gray-400 hover:text-white transition-colors">Reminders</a>
<a href="/chat" className="text-gray-400 hover:text-white transition-colors">Chat</a>
<a href="/settings" className="text-gray-400 hover:text-white transition-colors">Settings</a>
```

to:

```typescript
<a href="/tasks" className="text-gray-400 hover:text-white transition-colors">Tasks</a>
<a href="/chat" className="text-gray-400 hover:text-white transition-colors">Chat</a>
<a href="/settings" className="text-gray-400 hover:text-white transition-colors">Settings</a>
```

- [ ] Commit:

```bash
git add apps/web/src/app/(app)/layout.tsx
git commit -m "feat: remove reminders page and nav link"
```

---

### Task 9: Reset Tool Permissions in DB

The `tool_permissions` table still has rows for the old reminder tool names. Update them to the new names.

- [ ] Run via Supabase Studio (`http://127.0.0.1:54323`) or CLI:

```sql
DELETE FROM tool_permissions WHERE tool_name IN (
  'create_reminder', 'list_reminders', 'snooze_reminder', 'delete_reminder'
);
```

The route handler's `seedToolPermissions` will re-seed the new tool names (`snooze_task`, `delete_task`) with `enabled = true` on the next chat request.

---

### Task 10: Final Typecheck and Build

- [ ] Run full typecheck:

```bash
cd C:\Projects\Personal-Assistant
npm run typecheck
```

Expected: no errors across all workspaces.

- [ ] Run build:

```bash
npm run build --workspace=apps/web
```

Expected: clean build, all routes present.

- [ ] Commit:

```bash
git add -A
git commit -m "chore: verify clean build after reminders merge"
```
