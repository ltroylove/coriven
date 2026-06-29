import type Anthropic from '@anthropic-ai/sdk'
import type { ToolName } from '@personal-assistant/types'

export const ALL_TOOL_NAMES: ToolName[] = [
  'create_task',
  'update_task',
  'list_tasks',
  'add_reminder',
  'remove_reminder',
  'snooze_reminder',
  'delete_task',
  'save_memory',
  'recall_memories',
  'upsert_entity',
  'update_user_context',
  'summarize_conversation',
]

export const TOOL_REGISTRY: Record<ToolName, Anthropic.Tool> = {
  create_task: {
    name: 'create_task',
    description: 'Create a new task. Optionally include reminders inline.',
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
        reminders: {
          type: 'array',
          description: 'Optional list of reminders to create with the task.',
          items: {
            type: 'object',
            properties: {
              remind_at: { type: 'string', description: 'ISO 8601 datetime for the reminder' },
              recurrence_type: {
                type: 'string',
                enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'],
                description: 'How often to repeat. Default: none',
              },
              recurrence_end_at: { type: 'string', description: 'When to stop repeating, ISO 8601. Optional.' },
            },
            required: ['remind_at'],
          },
        },
      },
      required: ['title'],
    },
  },

  update_task: {
    name: 'update_task',
    description: 'Update task fields (title, description, priority, status, due date). Use add_reminder / remove_reminder to manage reminders.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (UUID)' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
        due_at: { type: 'string', description: 'ISO 8601 datetime or null to clear' },
      },
      required: ['id'],
    },
  },

  list_tasks: {
    name: 'list_tasks',
    description: "List the user's tasks, including all reminders on each task.",
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'cancelled'],
          description: 'Filter by status. Omit to return all.',
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        limit: { type: 'number', description: 'Max results. Default: 20' },
      },
      required: [],
    },
  },

  add_reminder: {
    name: 'add_reminder',
    description: 'Add a reminder to an existing task. A task can have multiple reminders.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (UUID) — get from list_tasks first' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime for the reminder' },
        recurrence_type: {
          type: 'string',
          enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'],
          description: 'How often to repeat. Default: none',
        },
        recurrence_end_at: { type: 'string', description: 'When to stop repeating, ISO 8601. Optional.' },
      },
      required: ['task_id', 'remind_at'],
    },
  },

  remove_reminder: {
    name: 'remove_reminder',
    description: 'Remove a specific reminder from a task.',
    input_schema: {
      type: 'object',
      properties: {
        reminder_id: { type: 'string', description: 'Reminder ID (UUID) — from list_tasks response' },
      },
      required: ['reminder_id'],
    },
  },

  snooze_reminder: {
    name: 'snooze_reminder',
    description: 'Snooze a reminder by pushing it back in time.',
    input_schema: {
      type: 'object',
      properties: {
        reminder_id: { type: 'string', description: 'Reminder ID (UUID) — from list_tasks response' },
        minutes: { type: 'number', description: 'Minutes to snooze, e.g. 30, 60, 1440 (1 day)' },
      },
      required: ['reminder_id', 'minutes'],
    },
  },

  delete_task: {
    name: 'delete_task',
    description: 'Permanently delete a task and all its reminders.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (UUID)' },
      },
      required: ['id'],
    },
  },

  save_memory: {
    name: 'save_memory',
    description: 'Store a piece of information as a long-term memory.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The information to store' },
        source: { type: 'string', description: 'Optional source label for this memory' },
      },
      required: ['content'],
    },
  },

  recall_memories: {
    name: 'recall_memories',
    description: 'Search stored memories by semantic similarity.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query to search memories' },
        limit: { type: 'number', description: 'Max results to return. Default: 5' },
      },
      required: ['query'],
    },
  },

  upsert_entity: {
    name: 'upsert_entity',
    description: 'Create or update an entity profile (person, place, project, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name' },
        type: { type: 'string', enum: ['person', 'place', 'project', 'thing', 'resource'] },
        description: { type: 'string', description: 'Details about this entity' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative names' },
      },
      required: ['name', 'type'],
    },
  },

  update_user_context: {
    name: 'update_user_context',
    description: 'Update stored user preferences or known facts.',
    input_schema: {
      type: 'object',
      properties: {
        preferences: { type: 'object', description: 'Key-value preferences to merge' },
        facts: { type: 'object', description: 'Key-value facts to merge' },
      },
      required: [],
    },
  },

  summarize_conversation: {
    name: 'summarize_conversation',
    description: 'Store a summary of the current conversation for future context.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'Conversation UUID' },
        summary: { type: 'string', description: 'Prose summary of the conversation' },
      },
      required: ['conversation_id', 'summary'],
    },
  },
}
