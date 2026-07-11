'use client'

import { useState, useTransition, useEffect } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { createTask, updateTask, getTask, addReminder, deleteReminder } from '@/app/actions/tasks'
import { useTimezone } from '@/components/providers/timezone-provider'
import { utcToLocalDatetime, localDatetimeToUtc } from '@/lib/utils/timezone'
import type { Task, TaskPriority, TaskStatus, TaskReminder, RecurrenceType } from '@personal-assistant/types'

type Props = {
  task?: Task | null
  onClose: () => void
}

type ReminderDraft = {
  key: string
  remind_at: string
  recurrence_type: RecurrenceType
  recurrence_end_at: string
  // If set, this is an existing reminder (not yet deleted)
  existingId?: string
}

function emptyDraft(): ReminderDraft {
  return { key: crypto.randomUUID(), remind_at: '', recurrence_type: 'none', recurrence_end_at: '' }
}

function reminderToDraft(r: TaskReminder, timezone: string): ReminderDraft {
  return {
    key: r.id,
    remind_at: utcToLocalDatetime(r.remind_at, timezone),
    recurrence_type: r.recurrence_type,
    recurrence_end_at: r.recurrence_end_at ? utcToLocalDatetime(r.recurrence_end_at, timezone) : '',
    existingId: r.id,
  }
}

export function TaskForm({ task, onClose }: Props) {
  const timezone = useTimezone()
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'pending')
  const [dueAt, setDueAt] = useState(task?.due_at ? utcToLocalDatetime(task.due_at, timezone) : '')
  const [reminders, setReminders] = useState<ReminderDraft[]>([])
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!task) {
      setTitle(''); setDescription(''); setPriority('medium'); setStatus('pending')
      setDueAt(''); setReminders([]); setRemovedIds([]); setError(null)
      return
    }
    getTask(task.id).then(fresh => {
      setTitle(fresh.title)
      setDescription(fresh.description ?? '')
      setPriority(fresh.priority)
      setStatus(fresh.status)
      setDueAt(fresh.due_at ? utcToLocalDatetime(fresh.due_at, timezone) : '')
      // Map fresh reminders to drafts
      const existing = (fresh as unknown as { reminders?: TaskReminder[] }).reminders ?? []
      setReminders(existing.map(r => reminderToDraft(r, timezone)))
      setRemovedIds([])
      setError(null)
    })
  }, [task?.id])

  function addReminderDraft() {
    setReminders(prev => [...prev, emptyDraft()])
  }

  function updateDraft(key: string, patch: Partial<ReminderDraft>) {
    setReminders(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function removeDraft(key: string, existingId?: string) {
    setReminders(prev => prev.filter(r => r.key !== key))
    if (existingId) setRemovedIds(prev => [...prev, existingId])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    for (const r of reminders) {
      if (!r.remind_at) { setError('Fill in all reminder times or remove empty reminders'); return }
    }
    setError(null)

    startTransition(async () => {
      try {
        if (task) {
          // Update task fields
          await updateTask(task.id, {
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            status,
            due_at: dueAt ? localDatetimeToUtc(dueAt, timezone) : undefined,
          })
          // Delete removed reminders
          for (const id of removedIds) await deleteReminder(id)
          // Add new reminders (those without existingId)
          for (const r of reminders) {
            if (!r.existingId) {
              await addReminder(task.id, {
                remind_at: localDatetimeToUtc(r.remind_at, timezone),
                recurrence_type: r.recurrence_type,
                recurrence_end_at: r.recurrence_end_at ? localDatetimeToUtc(r.recurrence_end_at, timezone) : undefined,
              })
            }
          }
        } else {
          await createTask({
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            due_at: dueAt ? localDatetimeToUtc(dueAt, timezone) : undefined,
            reminders: reminders
              .filter(r => r.remind_at)
              .map(r => ({
                remind_at: localDatetimeToUtc(r.remind_at, timezone),
                recurrence_type: r.recurrence_type,
                recurrence_end_at: r.recurrence_end_at ? localDatetimeToUtc(r.recurrence_end_at, timezone) : undefined,
              })),
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

          {/* Reminders */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-400">Reminders</label>
              <button
                type="button"
                onClick={addReminderDraft}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add reminder
              </button>
            </div>

            {reminders.length === 0 && (
              <p className="text-xs text-gray-600 italic">No reminders. Click "Add reminder" to set one.</p>
            )}

            <div className="space-y-3">
              {reminders.map(r => (
                <div key={r.key} className="bg-gray-800/60 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Remind at</span>
                    <button
                      type="button"
                      onClick={() => removeDraft(r.key, r.existingId)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={r.remind_at}
                    onChange={e => updateDraft(r.key, { remind_at: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={r.recurrence_type}
                    onChange={e => updateDraft(r.key, { recurrence_type: e.target.value as RecurrenceType })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays (Mon–Fri)</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  {r.recurrence_type !== 'none' && (
                    <input
                      type="datetime-local"
                      value={r.recurrence_end_at}
                      onChange={e => updateDraft(r.key, { recurrence_end_at: e.target.value })}
                      placeholder="End repeat on (optional)"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

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
