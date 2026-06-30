import { createServiceClient } from '@/lib/supabase/server'
import { generateEmbedding } from '@/lib/memory/embedding'

type WriteOp = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'

interface ClassifiedWrite {
  op: WriteOp
  content?: string
  supersedes?: string  // memory id to supersede on UPDATE
}

export async function classifyAndWriteMemory(
  userId: string,
  newFact: string,
): Promise<void> {
  const supabase = createServiceClient()

  // Find similar existing memories
  let similar: Array<{ id: string; content: string; similarity: number }> = []
  try {
    const embedding = await generateEmbedding(newFact)
    const { data } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(embedding),
      match_user_id: userId,
      match_count: 5,
      match_threshold: 0.7,
    })
    similar = data ?? []
  } catch {
    // If embedding fails, default to ADD
  }

  const classified = classify(newFact, similar)

  if (classified.op === 'NOOP') return

  if (classified.op === 'DELETE' && classified.supersedes) {
    // Insert a tombstone row so the superseded chain is intact
    const { data: tombstone } = await supabase
      .from('memories')
      .insert({ user_id: userId, content: '__deleted__', source: 'tombstone' })
      .select('id')
      .single()
    if (tombstone) {
      await supabase
        .from('memories')
        .update({ superseded_by: tombstone.id })
        .eq('id', classified.supersedes)
        .eq('user_id', userId)
    }
    return
  }

  const embedding = await generateEmbedding(newFact)

  if (classified.op === 'UPDATE' && classified.supersedes) {
    // Mark old memory superseded
    const { data: newMem } = await supabase
      .from('memories')
      .insert({ user_id: userId, content: newFact, embedding: JSON.stringify(embedding), source: 'chat' })
      .select('id')
      .single()
    if (newMem) {
      await supabase
        .from('memories')
        .update({ superseded_by: newMem.id })
        .eq('id', classified.supersedes)
        .eq('user_id', userId)
    }
    return
  }

  // ADD
  await supabase
    .from('memories')
    .insert({ user_id: userId, content: newFact, embedding: JSON.stringify(embedding), source: 'chat' })
}

function classify(
  newFact: string,
  similar: Array<{ id: string; content: string; similarity: number }>,
): ClassifiedWrite {
  // High similarity (>0.92) = likely contradiction/update
  const closeMatch = similar.find(m => m.similarity > 0.92)
  if (!closeMatch) return { op: 'ADD' }

  // Simple heuristic: negation words suggest DELETE, otherwise UPDATE
  const negation = /\b(no longer|not|never|stopped|moved away|deleted|removed)\b/i
  if (negation.test(newFact)) {
    return { op: 'DELETE', supersedes: closeMatch.id }
  }

  return { op: 'UPDATE', supersedes: closeMatch.id, content: newFact }
}
