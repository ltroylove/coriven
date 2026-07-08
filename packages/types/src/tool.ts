export type ToolName =
  | 'create_task'
  | 'update_task'
  | 'list_tasks'
  | 'add_reminder'
  | 'remove_reminder'
  | 'snooze_reminder'
  | 'delete_task'
  | 'save_memory'
  | 'recall_memories'
  | 'upsert_entity'
  | 'update_user_context'
  | 'summarize_conversation'
  | 'add_constraint'
  | 'list_constraints'
  | 'create_goal'
  | 'update_goal'
  | 'list_goals'
  | 'set_goal_momentum'
  | 'create_project'
  | 'generate_daily_briefing'
  | 'generate_weekly_review'
  | 'submit_for_approval'
  | 'get_email_thread'
  | 'detect_patterns'
  | 'push_notification'

export interface BehavioralConstraint {
  id: string
  user_id: string
  rule: string
  rationale: string
  scope: string
  is_locked: boolean
  created_at: string
  updated_at: string
}

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
