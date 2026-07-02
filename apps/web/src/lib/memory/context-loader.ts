import { readSentinelPackage, readSentinelPackageFromSupabase } from '@/lib/memory/sentinel'
import { assembleContext } from '@/lib/memory/context'
import type { SentinelPackage, EntityProfile, ConversationSummary, UserContext } from '@personal-assistant/types'

export interface MemoryContext {
  entityProfiles: EntityProfile[]
  memories: Array<{ id: string; content: string; similarity: number }>
  summaries: ConversationSummary[]
  userContext: UserContext | null
  source: 'upstash' | 'supabase' | 'inline'
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

function packageToMemoryContext(pkg: SentinelPackage, source: 'upstash' | 'supabase'): MemoryContext {
  return {
    entityProfiles: pkg.entity_profiles ?? [],
    memories: pkg.memories ?? [],
    summaries: pkg.summaries ?? [],
    userContext: pkg.user_context ?? null,
    source,
  }
}

export async function loadMemoryContext(
  userId: string,
  queryText: string
): Promise<MemoryContext> {
  // Tier 1: Upstash (~1ms)
  try {
    const pkg = await timeout(readSentinelPackage(userId), 2000)
    if (pkg) {
      console.info('[context-loader] Context source: upstash', { event: 'context_source', source: 'upstash', userId })
      return packageToMemoryContext(pkg, 'upstash')
    }
  } catch {
    // timeout or error — fall through
  }

  // Tier 2: Supabase (~10ms)
  try {
    const pkg = await timeout(readSentinelPackageFromSupabase(userId), 5000)
    if (pkg) {
      console.info('[context-loader] Context source: supabase', { event: 'context_source', source: 'supabase', userId })
      return packageToMemoryContext(pkg, 'supabase')
    }
  } catch {
    // timeout or error — fall through
  }

  // Tier 3: Inline assembly (~300ms)
  console.info('[context-loader] Context source: inline', { event: 'context_source', source: 'inline', userId })
  try {
    const assembled = await assembleContext(userId, queryText)
    return { ...assembled, source: 'inline' }
  } catch (err) {
    console.error('[context-loader] Inline assembly failed', { userId, err })
    return { entityProfiles: [], memories: [], summaries: [], userContext: null, source: 'inline' }
  }
}
