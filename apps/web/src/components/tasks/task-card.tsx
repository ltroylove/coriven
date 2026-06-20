'use client'

import { useTransition } from 'react'
import { CheckCircle, Circle, Trash2, Clock, Bell, Repeat, BellOff } from 'lucide-react'
import { updateTask, deleteTask, snoozeReminder, deleteReminder } from '@/app/actions/tasks'
import type { Task, TaskReminder } from '@personal-assistant/types'

const priorityColors = {
  low: 'text-gray-400 bg-gray-800',
  medium: 'text-blue-400 bg-blue-950',
  high: 'text-orange-400 bg-orange-950',
  urgent: 'text-red-400 bg-red-950',
}

const statusColors = {
  pending: 'text-gray-400',
  in_progress: 'text-blue-400',
  done: 'text-green-400 line-through opacity-60',
  cancelled: 'text-gray-600 line-through opacity-40',
}

const recurrenceLabels: Record<string, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

function formatRemindAt(isoString: string): string {
  const d = new Date(isoString)
  const diffMins = Math.round((d.getTime() - Date.now()) / 60000)
  if (diffMins < 0) return `overdue ${Math.abs(diffMins)}m ago`
  if (diffMins < 60) return `in ${diffMins}m`
  if (diffMins < 1440) return `in ${Math.round(diffMins / 60)}h`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ReminderRow({ reminder, isDone }: { reminder: TaskReminder; isDone: boolean }) {
  const [isPending, startTransition] = useTransition()
  const isSnoozed = reminder.snoozed_until && new Date(reminder.snoozed_until) > new Date()

  function handleSnooze(minutes: number) {
    startTransition(async () => { await snoozeReminder(reminder.id, minutes) })
  }

  function handleDelete() {
    startTransition(async () => { await deleteReminder(reminder.id) })
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 mt-1.5 ${isPending ? 'opacity-50' : ''}`} onClick={e => e.stopPropagation()}>
      <span className={`flex items-center gap-1 text-xs ${isSnoozed ? 'text-gray-500' : 'text-amber-400/80'}`}>
        {isSnoozed ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
        {isSnoozed ? 'snoozed' : formatRemindAt(reminder.remind_at)}
      </span>
      {reminder.recurrence_type !== 'none' && (
        <span className="flex items-center gap-1 text-xs text-purple-400/80">
          <Repeat className="w-3 h-3" />
          {recurrenceLabels[reminder.recurrence_type] ?? reminder.recurrence_type}
        </span>
      )}
      {!isDone && !isSnoozed && (
        <>
          {[15, 60, 1440].map(mins => (
            <button
              key={mins}
              onClick={() => handleSnooze(mins)}
              className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
            >
              {mins < 60 ? `${mins}m` : mins < 1440 ? `${mins / 60}h` : '1d'}
            </button>
          ))}
        </>
      )}
      <button
        onClick={handleDelete}
        className="text-gray-700 hover:text-red-400 transition-colors ml-auto"
        title="Remove reminder"
      >
        ×
      </button>
    </div>
  )
}

export function TaskCard({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const [isPending, startTransition] = useTransition()
  const isDone = task.status === 'done'
  const reminders = task.reminders ?? []

  function toggleDone() {
    startTransition(async () => {
      await updateTask(task.id, { status: isDone ? 'pending' : 'done' })
    })
  }

  function handleDelete() {
    if (!confirm('Delete this task?')) return
    startTransition(() => deleteTask(task.id))
  }

  return (
    <div className={`flex items-start gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg group transition-opacity ${isPending ? 'opacity-50' : ''}`}>
      <button onClick={toggleDone} className="mt-0.5 shrink-0 text-gray-500 hover:text-green-400 transition-colors">
        {isDone
          ? <CheckCircle className="w-5 h-5 text-green-500" />
          : <Circle className="w-5 h-5" />
        }
      </button>

      <div className="flex-1 min-w-0" onClick={() => onEdit(task)} role="button" tabIndex={0}>
        <p className={`text-sm font-medium truncate ${statusColors[task.status]}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityColors[task.priority]}`}>
            {task.priority}
          </span>
          {task.due_at && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              {new Date(task.due_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {reminders.map(r => (
          <ReminderRow key={r.id} reminder={r} isDone={isDone} />
        ))}
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
