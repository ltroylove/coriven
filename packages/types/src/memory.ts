export type EntityProfileType = 'person' | 'place' | 'project' | 'thing' | 'resource'

export interface EntityProfile {
  id: string
  user_id: string
  name: string
  type: EntityProfileType
  description: string | null
  aliases: string[]
  last_mentioned: string | null
  mention_count: number
  recency_weight: number
  created_at: string
  updated_at: string
}

export interface Memory {
  id: string
  user_id: string
  content: string
  embedding: number[] | null
  superseded_by: string | null
  source: string | null
  created_at: string
  updated_at: string
}

export interface UserContext {
  id: string
  user_id: string
  preferences: Record<string, unknown>
  facts: Record<string, unknown>
  updated_at: string
}

export interface ConversationSummary {
  id: string
  user_id: string
  conversation_id: string
  summary: string
  message_range: unknown | null
  created_at: string
}

export interface SentinelContext {
  id: string
  user_id: string
  package: SentinelPackage | null
  built_at: string | null
  updated_at: string
}

export interface SentinelPackage {
  entity_profiles: EntityProfile[]
  memories: Array<{ id: string; content: string; similarity: number }>
  summaries: ConversationSummary[]
  user_context: UserContext | null
  built_at: string
}
