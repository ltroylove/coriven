export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type RecurrenceType = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'

export interface TaskReminder {
  id: string
  task_id: string
  user_id: string
  remind_at: string
  recurrence_type: RecurrenceType
  recurrence_end_at: string | null
  snoozed_until: string | null
  last_fired_at: string | null
  created_at: string
}

export interface Task {
  id: string
  user_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  reminders?: TaskReminder[]
}

export type CreateTaskInput = Pick<Task, 'title'> &
  Partial<Pick<Task, 'description' | 'priority' | 'due_at'>> & {
    reminders?: Array<{
      remind_at: string
      recurrence_type?: RecurrenceType
      recurrence_end_at?: string
    }>
  }

export type UpdateTaskInput = Partial<
  Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_at'>
>

export type CreateReminderInput = {
  remind_at: string
  recurrence_type?: RecurrenceType
  recurrence_end_at?: string
}

export type UpdateReminderInput = Partial<{
  remind_at: string
  recurrence_type: RecurrenceType
  recurrence_end_at: string | null
}>

export function getNextOccurrence(reminder: Pick<TaskReminder, 'remind_at' | 'recurrence_type' | 'recurrence_end_at'>): Date | null {
  if (reminder.recurrence_type === 'none') return null

  const next = new Date(reminder.remind_at)

  switch (reminder.recurrence_type) {
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

  if (reminder.recurrence_end_at && next > new Date(reminder.recurrence_end_at)) return null
  return next
}
