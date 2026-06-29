import { anthropic, EXTRACTION_MODEL } from '@/lib/anthropic'
import { createServiceClient } from '@/lib/supabase/server'
import { classifyAndWriteMemory } from '@/lib/memory/writer'
import { assembleContext } from '@/lib/memory/context'
import type { Json } from '@/types/supabase'

const SENTINEL_TTL_SECONDS = 86400
const SENTINEL_KEY_PREFIX = 'sentinel:context:'
const MIN_MESSAGE_LENGTH = 10

// Lazy Upstash client — avoids breaking builds/tests when vars are absent
async function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const { Redis } = await import('@upstash/redis')
  return new Redis({ url, token })
}

export type MessageRole = 'user' | 'assistant'

interface ExtractionResult {
  entities: Array<{ name: string; type: string; description?: string }>
  facts: string[]
}

// ── Main entry point (fire-and-forget) ──────────────────────────────────────

export async function runSentinel(
  userId: string,
  messageText: string,
  role: MessageRole
): Promise<void> {
  try {
    // Step 1: Extract entities and facts via Haiku
    const extracted = await extractFromMessage(messageText, role)

    // Step 2: Persist entities
    const supabase = createServiceClient()
    for (const entity of extracted.entities) {
      try {
        await supabase.from('entity_profiles').upsert(
          {
            user_id: userId,
            name: entity.name,
            type: entity.type as never,
            description: entity.description ?? null,
          },
          { onConflict: 'user_id,name', ignoreDuplicates: false }
        )
      } catch (err) {
        console.warn('[sentinel] Entity upsert failed', { entity: entity.name, err })
      }
    }

    // Step 3: Classify and write facts
    for (const fact of extracted.facts) {
      try {
        await classifyAndWriteMemory(userId, fact)
      } catch (err) {
        console.warn('[sentinel] Fact write failed', { fact, err })
      }
    }

    // Step 4: Assemble context package
    const assembled = await assembleContext(userId, messageText)
    const pkg = {
      entity_profiles: assembled.entityProfiles,
      memories: assembled.memories,
      summaries: assembled.summaries,
      user_context: assembled.userContext,
      built_at: new Date().toISOString(),
    }

    // Step 5: Dual write — Upstash + Supabase
    await writePackageToUpstash(userId, pkg)
    await writePackageToSupabase(userId, pkg)
  } catch (err) {
    console.error('[sentinel] Unhandled error', { userId, err })
    // Never rethrow
  }
}

// ── Extraction via Haiku ─────────────────────────────────────────────────────

export async function extractFromMessage(
  messageText: string,
  role: MessageRole
): Promise<ExtractionResult> {
  if (messageText.trim().length < MIN_MESSAGE_LENGTH) {
    return { entities: [], facts: [] }
  }

  try {
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 512,
      system: `You extract structured information from conversation messages.
Return ONLY valid JSON (no markdown, no explanation) matching:
{"entities":[{"name":"string","type":"person|place|project|thing|resource","description":"string"}],"facts":["string"]}
- entities: named people, places, or projects mentioned with meaningful context
- facts: discrete, self-contained statements about the user's life, preferences, or relationships
- If nothing is worth remembering, return {"entities":[],"facts":[]}`,
      messages: [{ role: 'user', content: `Extract from this ${role} message:\n\n${messageText}` }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    return JSON.parse(text) as ExtractionResult
  } catch (err) {
    console.warn('[sentinel] Extraction failed', { role, err })
    return { entities: [], facts: [] }
  }
}

// ── Package writes ───────────────────────────────────────────────────────────

async function writePackageToUpstash(userId: string, pkg: unknown): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      console.warn('[sentinel] Upstash not configured — skipping cache write')
      return
    }
    await redis.set(`${SENTINEL_KEY_PREFIX}${userId}`, JSON.stringify(pkg), { ex: SENTINEL_TTL_SECONDS })
  } catch (err) {
    console.warn('[sentinel] Upstash write failed', { event: 'sentinel_upstash_write_fail', userId, err })
  }
}

async function writePackageToSupabase(userId: string, pkg: unknown): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('sentinel_context').upsert(
      { user_id: userId, package: pkg as Json, built_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  } catch (err) {
    console.error('[sentinel] Supabase write failed', { event: 'sentinel_write_fail', userId, err })
  }
}
