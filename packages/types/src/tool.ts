export type ToolName =
  | 'create_task'
  | 'update_task'
  | 'list_tasks'
  | 'add_reminder'
  | 'remove_reminder'
  | 'snooze_reminder'
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
