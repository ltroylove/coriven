import { createServiceClient } from '@/lib/supabase/server'
import { generateEmbedding } from '@/lib/memory/embedding'
import type { EntityProfile, ConversationSummary, UserContext } from '@personal-assistant/types'

export interface AssembledContext {
  entityProfiles: EntityProfile[]
  memories: Array<{ id: string; content: string; similarity: number }>
  summaries: ConversationSummary[]
  userContext: UserContext | null
}

const ENTITY_TOKEN_BUDGET = 500   // ~500 tokens max for entity profiles
const TOP_K_MEMORIES = 8
const RECENT_SUMMARIES = 3

export async function assembleContext(
  userId: string,
  latestUserMessage: string
): Promise<AssembledContext> {
  const supabase = createServiceClient()

  // Layer 1: Entity profiles (always-in-context, capped by token budget)
  const { data: entities } = await supabase
    .from('entity_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('recency_weight', { ascending: false })
    .order('mention_count', { ascending: false })

  // Layer 2: Semantic memories (top-k by cosine similarity)
  let memories: Array<{ id: string; content: string; similarity: number }> = []
  try {
    const embedding = await generateEmbedding(latestUserMessage)
    const { data: memData } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(embedding),
      match_user_id: userId,
      match_count: TOP_K_MEMORIES,
      match_threshold: 0.7,
    })
    memories = memData ?? []
  } catch {
    // Embedding failure degrades gracefully — chat continues without semantic memories
    console.warn('[context] Embedding unavailable; skipping semantic memory retrieval')
  }

  // Layer 3: Recent conversation summaries
  const { data: summaries } = await supabase
    .from('conversation_summaries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(RECENT_SUMMARIES)

  // User context (preferences, facts)
  const { data: ctxRows } = await supabase
    .from('user_context')
    .select('*')
    .eq('user_id', userId)
    .limit(1)

  return {
    entityProfiles: truncateToTokenBudget(entities ?? [], ENTITY_TOKEN_BUDGET),
    memories,
    summaries: (summaries ?? []).reverse(), // chronological order
    userContext: ctxRows?.[0] ? {
      id: ctxRows[0].id,
      user_id: ctxRows[0].user_id,
      preferences: ctxRows[0].preferences as Record<string, unknown>,
      facts: ctxRows[0].facts as Record<string, unknown>,
      updated_at: ctxRows[0].updated_at,
    } : null,
  }
}

function truncateToTokenBudget(profiles: EntityProfile[], budgetTokens: number): EntityProfile[] {
  // Rough estimate: 1 token ≈ 4 chars
  let used = 0
  const result: EntityProfile[] = []
  for (const p of profiles) {
    const cost = Math.ceil(JSON.stringify(p).length / 4)
    if (used + cost > budgetTokens) break
    result.push(p)
    used += cost
  }
  return result
}
