import { createServiceClient } from '@/lib/supabase/server'
import { generateEmbedding } from '@/lib/memory/embedding'
import { classifyAndWriteMemory } from '@/lib/memory/writer'

// ── save_memory ──────────────────────────────────────────────────────────────
export async function handleSaveMemory(
  userId: string,
  input: { content: string; source?: string }
): Promise<string> {
  if (!input.content?.trim()) return 'Nothing to save — content was empty.'
  await classifyAndWriteMemory(userId, input.content.trim())
  return `Memory saved: "${input.content.trim()}"`
}

// ── recall_memories ──────────────────────────────────────────────────────────
export async function handleRecallMemories(
  userId: string,
  input: { query: string; limit?: number }
): Promise<string> {
  const limit = Math.min(input.limit ?? 5, 20)
  const supabase = createServiceClient()
  let results: Array<{ id: string; content: string; similarity: number }> = []

  try {
    const embedding = await generateEmbedding(input.query)
    const { data } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(embedding),
      match_user_id: userId,
      match_count: limit,
      match_threshold: 0.7,
    })
    results = data ?? []
  } catch {
    return 'Memory recall is temporarily unavailable.'
  }

  if (results.length === 0) return 'No relevant memories found.'
  return results.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
}

// ── upsert_entity ────────────────────────────────────────────────────────────
export async function handleUpsertEntity(
  userId: string,
  input: {
    name: string
    type: string
    description?: string
    aliases?: string[]
  }
): Promise<string> {
  const supabase = createServiceClient()

  // Exact name match first (case-insensitive)
  const { data: exact } = await supabase
    .from('entity_profiles')
    .select('id, name, aliases')
    .eq('user_id', userId)
    .ilike('name', input.name.trim())
    .limit(1)

  if (exact && exact.length > 0) {
    const existing = exact[0]
    const newAliases = [
      ...new Set([...(existing.aliases ?? []), ...(input.aliases ?? [])]),
    ]
    await supabase
      .from('entity_profiles')
      .update({
        description: input.description,
        aliases: newAliases,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('user_id', userId)

    return `Updated entity "${existing.name}".`
  }

  // Alias / fuzzy match across all entities
  const { data: allEntities } = await supabase
    .from('entity_profiles')
    .select('id, name, aliases')
    .eq('user_id', userId)

  const aliasMatch = (allEntities ?? []).find(e =>
    (e.aliases ?? []).some(
      (a: string) => levenshtein(a.toLowerCase(), input.name.toLowerCase()) <= 2
    ) || levenshtein(e.name.toLowerCase(), input.name.toLowerCase()) <= 2
  )

  if (aliasMatch) {
    const newAliases = [
      ...new Set([
        ...(aliasMatch.aliases ?? []),
        input.name.trim(),
        ...(input.aliases ?? []),
      ]),
    ]
    await supabase
      .from('entity_profiles')
      .update({
        aliases: newAliases,
        description: input.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', aliasMatch.id)
      .eq('user_id', userId)
    return `Updated existing entity "${aliasMatch.name}" (matched by alias/fuzzy).`
  }

  // Create new entity
  await supabase.from('entity_profiles').insert({
    user_id: userId,
    name: input.name.trim(),
    type: input.type as never,
    description: input.description ?? null,
    aliases: input.aliases ?? [],
  })
  return `Created entity "${input.name.trim()}".`
}

// ── update_user_context ──────────────────────────────────────────────────────
// The tool schema sends `preferences` and/or `facts` as plain objects to merge.
export async function handleUpdateUserContext(
  userId: string,
  input: {
    preferences?: Record<string, unknown>
    facts?: Record<string, unknown>
  }
): Promise<string> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('user_context')
    .select('id, preferences, facts')
    .eq('user_id', userId)
    .limit(1)

  const row = existing?.[0]
  const currentPrefs = (row?.preferences as Record<string, unknown>) ?? {}
  const currentFacts = (row?.facts as Record<string, unknown>) ?? {}

  const updatedPrefs = input.preferences
    ? { ...currentPrefs, ...input.preferences }
    : currentPrefs
  const updatedFacts = input.facts
    ? { ...currentFacts, ...input.facts }
    : currentFacts

  if (row) {
    await supabase
      .from('user_context')
      .update({
        preferences: updatedPrefs as never,
        facts: updatedFacts as never,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('user_id', userId)
  } else {
    await supabase.from('user_context').insert({
      user_id: userId,
      preferences: updatedPrefs as never,
      facts: updatedFacts as never,
    })
  }

  const parts: string[] = []
  if (input.preferences) parts.push(`preferences: ${JSON.stringify(input.preferences)}`)
  if (input.facts) parts.push(`facts: ${JSON.stringify(input.facts)}`)
  return `Updated user context — ${parts.join('; ') || 'no changes'}`
}

// ── summarize_conversation ───────────────────────────────────────────────────
export async function handleSummarizeConversation(
  userId: string,
  input: { conversation_id: string; summary: string; message_count?: number }
): Promise<string> {
  const supabase = createServiceClient()

  await supabase.from('conversation_summaries').insert({
    user_id: userId,
    conversation_id: input.conversation_id,
    summary: input.summary.trim(),
  })

  return `Conversation summary saved.`
}

// ── Levenshtein distance (simple iterative) ──────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
