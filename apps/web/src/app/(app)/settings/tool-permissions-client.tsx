'use client'

import { useState } from 'react'
import type { ToolName } from '@personal-assistant/types'

const TOOL_LABELS: Record<ToolName, { label: string; description: string }> = {
  create_task: { label: 'Create tasks', description: 'Add new tasks and reminders on your behalf' },
  update_task: { label: 'Update tasks', description: 'Mark tasks complete, change priority, edit details' },
  list_tasks: { label: 'Read tasks', description: 'Look up your task list to answer questions' },
  add_reminder: { label: 'Add reminders', description: 'Add reminders to tasks on your behalf' },
  remove_reminder: { label: 'Remove reminders', description: 'Delete a specific reminder from a task' },
  snooze_reminder: { label: 'Snooze reminders', description: 'Postpone a reminder by a set time' },
  delete_task: { label: 'Delete tasks', description: 'Permanently remove tasks and all their reminders' },
  save_memory: { label: 'Save memories', description: 'Store information from conversations for future recall' },
  recall_memories: { label: 'Recall memories', description: 'Search stored memories to answer questions' },
  upsert_entity: { label: 'Manage entities', description: 'Create or update profiles for people, places, and projects' },
  update_user_context: { label: 'Update context', description: 'Update your preferences and known facts' },
  summarize_conversation: { label: 'Summarize conversations', description: 'Generate summaries of past conversations' },
  add_constraint: { label: 'Add constraints', description: 'Save behavioral rules that Coriven must always follow' },
  list_constraints: { label: 'List constraints', description: 'Show your active behavioral constraints in chat' },
  create_goal: { label: 'Create goals', description: 'Add new goals to your goal hierarchy' },
  update_goal: { label: 'Update goals', description: 'Edit goal details, status, and confidence' },
  list_goals: { label: 'Read goals', description: 'Look up your goals and their associated project counts' },
  set_goal_momentum: { label: 'Set goal momentum', description: 'Update the momentum signal on a goal' },
  create_project: { label: 'Create projects', description: 'Add new projects linked to your goals' },
  generate_daily_briefing: { label: 'Generate daily briefing', description: 'Assemble a daily briefing package from your goals and tasks' },
}

type Permission = { tool_name: ToolName; enabled: boolean }

export function ToolPermissionsClient({ initial }: { initial: Permission[] }) {
  const [permissions, setPermissions] = useState<Record<ToolName, boolean>>(
    () => Object.fromEntries(initial.map(p => [p.tool_name, p.enabled])) as Record<ToolName, boolean>,
  )
  const [saving, setSaving] = useState<ToolName | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(toolName: ToolName) {
    const newVal = !permissions[toolName]
    setSaving(toolName)
    setError(null)

    try {
      const res = await fetch(`/api/tools/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newVal }),
      })
      if (!res.ok) throw new Error(await res.text())
      setPermissions(prev => ({ ...prev, [toolName]: newVal }))
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(null)
    }
  }

  const toolNames = Object.keys(TOOL_LABELS) as ToolName[]

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-2">
          {error}
        </p>
      )}
      {toolNames.map(name => {
        const { label, description } = TOOL_LABELS[name]
        const enabled = permissions[name] ?? false
        const isSaving = saving === name

        return (
          <div
            key={name}
            className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-800 bg-gray-900/60"
          >
            <div>
              <p className="text-sm font-medium text-gray-200">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
            <button
              onClick={() => toggle(name)}
              disabled={isSaving}
              aria-checked={enabled}
              role="switch"
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                enabled ? 'bg-emerald-600' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
