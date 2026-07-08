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
  'add_constraint',
  'list_constraints',
  'create_goal',
  'update_goal',
  'list_goals',
  'set_goal_momentum',
  'create_project',
  'generate_daily_briefing',
  'submit_for_approval',
  'get_email_thread',
  'detect_patterns',
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

  add_constraint: {
    name: 'add_constraint',
    description:
      'Save a behavioral constraint — a rule Coriven must always follow. Always include the rationale (why the rule exists); this field is required and cannot be empty.',
    input_schema: {
      type: 'object',
      properties: {
        rule: { type: 'string', description: 'The behavioral rule, e.g. "never modify MealPrepForge code"' },
        rationale: {
          type: 'string',
          description: "The reason this rule exists — required. E.g. 'MealPrepForge is a separate business'",
        },
        scope: {
          type: 'string',
          description: 'Optional scope tag (e.g. "MealPrepForge", "email"). Defaults to "all" (applies everywhere).',
        },
        is_locked: {
          type: 'boolean',
          description:
            'If true, this constraint cannot be overridden. Locked constraints are hard stops. Defaults to false.',
        },
      },
      required: ['rule', 'rationale'],
    },
  },

  list_constraints: {
    name: 'list_constraints',
    description: "List the owner's active behavioral constraints. Optionally filter by scope.",
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Optional scope filter. Returns constraints matching this scope plus all global ("all") constraints.',
        },
      },
      required: [],
    },
  },

  create_goal: {
    name: 'create_goal',
    description: 'Create a new goal for the user, optionally linked to a life area.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, clear goal title' },
        life_area_id: { type: 'string', description: 'UUID of the life area this goal belongs to. Optional.' },
        why_it_matters: { type: 'string', description: 'The underlying motivation or reason this goal is important. Optional.' },
        success_metrics: { type: 'string', description: 'How success will be measured. Optional.' },
        status: {
          type: 'string',
          enum: ['active', 'achieved', 'paused', 'abandoned'],
          description: 'Goal status. Default: active',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence in achieving this goal. Default: medium',
        },
      },
      required: ['title'],
    },
  },

  update_goal: {
    name: 'update_goal',
    description: 'Update fields on an existing goal. Only include fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID (UUID)' },
        title: { type: 'string', description: 'Updated goal title' },
        why_it_matters: { type: 'string', description: 'Updated motivation text' },
        success_metrics: { type: 'string', description: 'Updated success metrics' },
        status: {
          type: 'string',
          enum: ['active', 'achieved', 'paused', 'abandoned'],
          description: 'Updated goal status',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Updated confidence level',
        },
        life_area_id: {
          type: ['string', 'null'],
          description: 'Life area UUID to assign this goal to, or null to remove the association',
        },
      },
      required: ['id'],
    },
  },

  list_goals: {
    name: 'list_goals',
    description: "List the user's goals, with a count of associated projects for each. Optionally filter by life area or status.",
    input_schema: {
      type: 'object',
      properties: {
        life_area_id: { type: 'string', description: 'Filter by life area UUID. Optional.' },
        status: {
          type: 'string',
          enum: ['active', 'achieved', 'paused', 'abandoned'],
          description: 'Filter by goal status. Omit to return all.',
        },
        limit: { type: 'number', description: 'Max results to return. Default: 20' },
      },
      required: [],
    },
  },

  set_goal_momentum: {
    name: 'set_goal_momentum',
    description: "Update the momentum signal on a goal to reflect recent progress direction.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID (UUID)' },
        momentum: {
          type: 'string',
          enum: ['improving', 'stable', 'declining'],
          description: 'The new momentum value for this goal',
        },
      },
      required: ['id', 'momentum'],
    },
  },

  create_project: {
    name: 'create_project',
    description: 'Create a new project linked to a goal. Projects are mid-level work items that contain tasks.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, clear project title' },
        goal_id: { type: 'string', description: 'UUID of the goal this project supports' },
        description: { type: 'string', description: 'Optional longer description of the project' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'cancelled'],
          description: 'Project status. Default: pending',
        },
      },
      required: ['title', 'goal_id'],
    },
  },

  generate_daily_briefing: {
    name: 'generate_daily_briefing',
    description:
      'Assembles and returns today\'s daily briefing from your goals, upcoming tasks, and stalled goals. No AI generation — deterministic summary from your data.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  get_email_thread: {
    name: 'get_email_thread',
    description:
      'Fetch the full body of a specific email message on demand from the user\'s connected email account. ' +
      'The content is retrieved live and is never stored. ' +
      'Use this when the user asks to read or discuss the content of a specific email.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['gmail', 'outlook'],
          description: 'The email provider that owns this message.',
        },
        message_id: {
          type: 'string',
          description: 'The provider-native message ID (from email_metadata).',
        },
      },
      required: ['provider', 'message_id'],
    },
  },

  detect_patterns: {
    name: 'detect_patterns',
    description:
      "Retrieve behavioral patterns Coriven has detected about the user's habits and blockers. " +
      'Returns active patterns by default. Use pattern_type to filter to a specific type. ' +
      'Results come from the nightly detection job — patterns must be detected before they appear here.',
    input_schema: {
      type: 'object',
      properties: {
        pattern_type: {
          type: 'string',
          enum: ['gym_days', 'weekly_review_time', 'stale_goal', 'follow_up_needed'],
          description: 'Filter to a specific pattern type. Omit to return all types.',
        },
        is_active: {
          type: 'boolean',
          description: 'Whether to return only active patterns. Default: true.',
        },
      },
      required: [],
    },
  },

  submit_for_approval: {
    name: 'submit_for_approval',
    description:
      'Propose an external-world action (send email, create/update calendar event) for the user to review. ' +
      'The action does NOT execute — it enters a pending approval queue where the user can approve, modify, or cancel it. ' +
      'Always use this instead of acting directly when an action would change state outside Coriven.',
    input_schema: {
      type: 'object',
      properties: {
        action_type: {
          type: 'string',
          enum: ['send_email', 'create_calendar_event', 'update_calendar_event'],
          description: 'The type of external action being proposed.',
        },
        provider: {
          type: 'string',
          enum: ['gmail', 'outlook', 'google_calendar', 'outlook_calendar'],
          description: 'The provider/integration that would execute this action.',
        },
        payload: {
          type: 'object',
          description:
            'Structured data for the action. ' +
            'send_email: { to, subject, body }. ' +
            'create_calendar_event: { title, start (ISO 8601), end (ISO 8601), description?, attendees? }. ' +
            'update_calendar_event: { event_id, title?, start?, end?, description? }.',
        },
        ai_summary: {
          type: 'string',
          description:
            'A short plain-language description of what this action does and why you are proposing it. ' +
            'Shown alongside the raw payload on the approvals page. Optional.',
        },
      },
      required: ['action_type', 'provider', 'payload'],
    },
  },
}
