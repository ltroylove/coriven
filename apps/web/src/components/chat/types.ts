export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
  created_at: string
}

export type Conversation = {
  id: string
  title: string
  created_at: string
  updated_at: string
}
