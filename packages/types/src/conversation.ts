export type MessageRole = 'user' | 'assistant'

export interface ConversationMessage {
  id: string
  user_id: string
  role: MessageRole
  content: string
  tool_calls: unknown | null
  created_at: string
}
