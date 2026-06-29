# Phase 2 — Memory & Sentinel Architecture Implementation Plan

**Goal:** Build a persistent memory system powered by an async sentinel agent that extracts entities and facts from every conversation turn, stores them in Supabase, and maintains a pre-built context package in Upstash Redis that gets injected into every Claude call.

**Architecture:** An async sentinel job fires after every message (user and assistant). It uses Claude Haiku to extract entities and memories, saves them to Supabase, then builds a context package and writes it to Upstash Redis. The main chat API route reads the context package from Upstash (~1ms), appends the last 3 raw messages, and passes both to Claude Sonnet. Claude Sonnet never sees raw conversation history beyond the last 3 messages — it only sees the sentinel's curated context. On cold start, Upstash is warmed from the Supabase fallback.

**Tech Stack:** Supabase (pgvector + Postgres), Upstash Redis (`@upstash/redis`), OpenAI embeddings (`text-embedding-3-small`), Claude Haiku 4.5 (extraction), Claude Sonnet 4.6 (main chat, unchanged)

---

## New Environment Variables

Add to `.env.local` and `.env.example`:

```bash
# Upstash Redis
UPSTASH_REDIS_REST_URL=      # from Upstash console
UPSTASH_REDIS_REST_TOKEN=    # from Upstash console

# OpenAI (embeddings only)
OPENAI_API_KEY=
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/YYYYMMDD_phase2_memory.sql` | Create | DB tables: entity_profiles, memories, sentinel_context |
| `packages/types/src/memory.ts` | Create | Shared TypeScript types |
| `packages/types/src/index.ts` | Modify | Export memory types |
| `apps/web/src/lib/memory/cache.ts` | Create | Upstash read/write for sentinel context |
| `apps/web/src/lib/memory/store.ts` | Create | Supabase read/write for entities, memories, sentinel context |
| `apps/web/src/lib/memory/embed.ts` | Create | OpenAI text-embedding-3-small wrapper |
| `apps/web/src/lib/memory/extract.ts` | Create | Haiku-based extraction of entities + memories from one message |
| `apps/web/src/lib/memory/build-context.ts` | Create | Pure-code context package builder (no LLM) |
| `apps/web/src/lib/memory/sentinel.ts` | Create | Orchestrator: extract → save → build → cache |
| `apps/web/src/app/api/sentinel/route.ts` | Create | POST endpoint that runs the sentinel job async |
| `apps/web/src/app/api/chat/route.ts` | Modify | Fire sentinel, read context package from Upstash |
| `apps/web/src/lib/chat/tools/registry.ts` | Modify | Register save_memory and upsert_entity tools |
| `apps/web/src/lib/chat/tools/handlers/save_memory.ts` | Create | Claude explicitly saves a memory |
| `apps/web/src/lib/chat/tools/handlers/upsert_entity.ts` | Create | Claude explicitly saves an entity |
| `apps/web/src/app/(app)/memory/page.tsx` | Create | Memory management UI — two tabs: Memories + Entities |
| `apps/web/src/app/actions/memory.ts` | Create | Server Actions for memory CRUD |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDD_phase2_memory.sql`

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new phase2_memory
```

- [ ] **Step 2: Write the migration**

Open the generated file and paste:

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Entity profiles: people, places, projects, things the user mentions
CREATE TABLE entity_profiles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  entity_type  text        NOT NULL CHECK (entity_type IN ('person', 'place', 'project', 'thing')),
  description  text        NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE entity_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own entities"
  ON entity_profiles FOR ALL
  USING (user_id = auth.uid());

-- Memories: facts extracted from conversation
CREATE TABLE memories (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content          text        NOT NULL,
  entity_name      text,
  embedding        vector(1536),
  superseded_by    uuid        REFERENCES memories(id),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own memories"
  ON memories FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Sentinel context: persisted context package (Supabase fallback for Upstash)
CREATE TABLE sentinel_context (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  context    text        NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sentinel_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own sentinel context"
  ON sentinel_context FOR ALL
  USING (user_id = auth.uid());
```

- [ ] **Step 3: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applied with no errors.

- [ ] **Step 4: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --linked > apps/web/src/types/supabase.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ apps/web/src/types/supabase.ts
git commit -m "feat: phase 2 memory tables — entity_profiles, memories, sentinel_context"
```

---

## Task 2: Shared Types

**Files:**
- Create: `packages/types/src/memory.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create memory types**

```typescript
// packages/types/src/memory.ts

export type EntityType = 'person' | 'place' | 'project' | 'thing'

export interface EntityProfile {
  id: string
  userId: string
  name: string
  entityType: EntityType
  description: string
  createdAt: string
  updatedAt: string
}

export interface Memory {
  id: string
  userId: string
  content: string
  entityName: string | null
  supersededBy: string | null
  createdAt: string
}

export interface SentinelContext {
  userId: string
  context: string
  updatedAt: string
}

export interface ExtractionResult {
  entities: Array<{
    name: string
    entityType: EntityType
    description: string
  }>
  memories: Array<{
    content: string
    entityName: string | null
  }>
}
```

- [ ] **Step 2: Export from index**

Open `packages/types/src/index.ts` and add:

```typescript
export * from './memory'
```

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/
git commit -m "feat: add shared memory types"
```

---

## Task 3: Upstash Cache Layer

**Files:**
- Create: `apps/web/src/lib/memory/cache.ts`

- [ ] **Step 1: Install Upstash Redis**

```bash
npm install @upstash/redis
```

- [ ] **Step 2: Create the cache module**

```typescript
// apps/web/src/lib/memory/cache.ts
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const KEY = (userId: string) => `sentinel:context:${userId}`
const TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function getCachedContext(userId: string): Promise<string | null> {
  return redis.get<string>(KEY(userId))
}

export async function setCachedContext(userId: string, context: string): Promise<void> {
  await redis.set(KEY(userId), context, { ex: TTL_SECONDS })
}
```

- [ ] **Step 3: Verify the module compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/memory/cache.ts package.json package-lock.json
git commit -m "feat: Upstash Redis cache layer for sentinel context"
```

---

## Task 4: Supabase Memory Store

**Files:**
- Create: `apps/web/src/lib/memory/store.ts`

- [ ] **Step 1: Create the store module**

```typescript
// apps/web/src/lib/memory/store.ts
import { createClient } from '@/lib/supabase/server'
import type { EntityProfile, Memory, ExtractionResult } from '@personal-assistant/types'

// ── Entity profiles ──────────────────────────────────────────────────────────

export async function upsertEntityProfile(
  userId: string,
  entity: ExtractionResult['entities'][number]
): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('entity_profiles')
    .upsert(
      {
        user_id: userId,
        name: entity.name,
        entity_type: entity.entityType,
        description: entity.description,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,name' }
    )
}

export async function getAllEntityProfiles(userId: string): Promise<EntityProfile[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('entity_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    entityType: row.entity_type,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function deleteEntityProfile(userId: string, entityId: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('entity_profiles')
    .delete()
    .eq('id', entityId)
    .eq('user_id', userId)
}

// ── Memories ─────────────────────────────────────────────────────────────────

export async function saveMemory(
  userId: string,
  content: string,
  entityName: string | null,
  embedding: number[]
): Promise<void> {
  const supabase = await createClient()

  // Check for existing memory about the same entity that may be superseded
  if (entityName) {
    const { data: existing } = await supabase
      .from('memories')
      .select('id, content')
      .eq('user_id', userId)
      .eq('entity_name', entityName)
      .is('superseded_by', null)

    if (existing && existing.length > 0) {
      // New memory about same entity — supersede the old ones
      const { data: newMemory } = await supabase
        .from('memories')
        .insert({
          user_id: userId,
          content,
          entity_name: entityName,
          embedding: JSON.stringify(embedding),
        })
        .select('id')
        .single()

      if (newMemory) {
        await supabase
          .from('memories')
          .update({ superseded_by: newMemory.id })
          .in('id', existing.map(m => m.id))
      }
      return
    }
  }

  await supabase.from('memories').insert({
    user_id: userId,
    content,
    entity_name: entityName,
    embedding: JSON.stringify(embedding),
  })
}

export async function searchMemories(
  userId: string,
  queryEmbedding: number[],
  limit = 5
): Promise<Memory[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('match_memories', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_user_id: userId,
    match_count: limit,
  })
  return (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    content: row.content,
    entityName: row.entity_name,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
  }))
}

export async function getAllMemories(userId: string): Promise<Memory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    content: row.content,
    entityName: row.entity_name,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
  }))
}

export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('memories')
    .delete()
    .eq('id', memoryId)
    .eq('user_id', userId)
}

// ── Sentinel context (Supabase fallback) ─────────────────────────────────────

export async function saveSentinelContext(userId: string, context: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('sentinel_context')
    .upsert({ user_id: userId, context, updated_at: new Date().toISOString() })
}

export async function loadSentinelContext(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sentinel_context')
    .select('context')
    .eq('user_id', userId)
    .single()
  return data?.context ?? null
}
```

- [ ] **Step 2: Add the match_memories RPC function**

Create a new migration:

```bash
npx supabase migration new match_memories_rpc
```

Open the new file and paste:

```sql
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id            uuid,
  user_id       uuid,
  content       text,
  entity_name   text,
  superseded_by uuid,
  created_at    timestamptz,
  similarity    float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.user_id,
    m.content,
    m.entity_name,
    m.superseded_by,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.user_id = match_user_id
    AND m.superseded_by IS NULL
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

Apply it:

```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/memory/store.ts supabase/migrations/
git commit -m "feat: Supabase memory store — entities, memories, sentinel context"
```

---

## Task 5: OpenAI Embedding Service

**Files:**
- Create: `apps/web/src/lib/memory/embed.ts`

- [ ] **Step 1: Install OpenAI SDK**

```bash
npm install openai
```

- [ ] **Step 2: Create the embed module**

```typescript
// apps/web/src/lib/memory/embed.ts
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // stay within token limit
  })
  return response.data[0].embedding
}
```

- [ ] **Step 3: Verify types compile**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/memory/embed.ts package.json package-lock.json
git commit -m "feat: OpenAI text-embedding-3-small wrapper"
```

---

## Task 6: Haiku Extraction

**Files:**
- Create: `apps/web/src/lib/memory/extract.ts`

This module calls Claude Haiku with a single message and returns structured entities and memories to save.

- [ ] **Step 1: Create the extraction module**

```typescript
// apps/web/src/lib/memory/extract.ts
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractionResult } from '@personal-assistant/types'

const client = new Anthropic()

const SYSTEM = `You are a memory extraction assistant. Given a single message from a conversation, extract:
1. Named entities mentioned: people, places, projects, or recurring things
2. Durable facts worth remembering about the user or the entities

Rules:
- Only extract things the USER reveals about themselves or their life, not questions asked or general statements
- For entities, write a SHORT description (one sentence) that captures what is known
- For memories, write a SHORT factual statement (one sentence)
- If nothing worth extracting exists, return empty arrays
- Do not invent or infer beyond what is stated

Return ONLY valid JSON in this exact shape:
{
  "entities": [
    { "name": "string", "entityType": "person|place|project|thing", "description": "string" }
  ],
  "memories": [
    { "content": "string", "entityName": "string or null" }
  ]
}`

export async function extractFromMessage(
  role: 'user' | 'assistant',
  content: string
): Promise<ExtractionResult> {
  // Only extract from user messages — assistant messages are responses, not disclosures
  if (role === 'assistant') return { entities: [], memories: [] }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Message to analyze:\n\n${content}` }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

  try {
    const parsed = JSON.parse(text)
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    }
  } catch {
    return { entities: [], memories: [] }
  }
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/memory/extract.ts
git commit -m "feat: Haiku-based entity and memory extraction"
```

---

## Task 7: Context Package Builder

**Files:**
- Create: `apps/web/src/lib/memory/build-context.ts`

Pure code — no LLM call. Queries the stores and formats the context package string.

- [ ] **Step 1: Create the builder**

```typescript
// apps/web/src/lib/memory/build-context.ts
import { getAllEntityProfiles, searchMemories } from './store'
import { embed } from './embed'

export async function buildContextPackage(
  userId: string,
  recentMessages: Array<{ role: string; content: string }>
): Promise<string> {
  const [entities, memories] = await Promise.all([
    getAllEntityProfiles(userId),
    (async () => {
      if (recentMessages.length === 0) return []
      const recentText = recentMessages
        .slice(-3)
        .map(m => m.content)
        .join('\n')
      const queryEmbedding = await embed(recentText)
      return searchMemories(userId, queryEmbedding, 5)
    })(),
  ])

  const parts: string[] = []

  if (entities.length > 0) {
    const byType: Record<string, string[]> = {}
    for (const e of entities) {
      if (!byType[e.entityType]) byType[e.entityType] = []
      byType[e.entityType].push(`- ${e.name}: ${e.description}`)
    }
    const entityLines = Object.entries(byType)
      .map(([type, lines]) => `**${type.charAt(0).toUpperCase() + type.slice(1)}s:**\n${lines.join('\n')}`)
      .join('\n\n')
    parts.push(`### People, places & projects in your life:\n${entityLines}`)
  }

  if (memories.length > 0) {
    const memoryLines = memories.map(m => `- ${m.content}`).join('\n')
    parts.push(`### Things I've learned about you:\n${memoryLines}`)
  }

  if (parts.length === 0) return ''

  return `## What I know about you\n\n${parts.join('\n\n')}`
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/memory/build-context.ts
git commit -m "feat: context package builder — entities + semantic memories"
```

---

## Task 8: Sentinel Orchestrator

**Files:**
- Create: `apps/web/src/lib/memory/sentinel.ts`
- Create: `apps/web/src/app/api/sentinel/route.ts`

- [ ] **Step 1: Create the sentinel orchestrator**

```typescript
// apps/web/src/lib/memory/sentinel.ts
import { extractFromMessage } from './extract'
import { embed } from './embed'
import { upsertEntityProfile, saveMemory, saveSentinelContext } from './store'
import { setCachedContext } from './cache'
import { buildContextPackage } from './build-context'
import { createClient } from '@/lib/supabase/server'

export async function runSentinel(
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  // 1. Extract entities and memories from this message
  const extracted = await extractFromMessage(role, content)

  // 2. Save entities
  for (const entity of extracted.entities) {
    await upsertEntityProfile(userId, entity)
  }

  // 3. Save memories with embeddings
  for (const memory of extracted.memories) {
    const embedding = await embed(memory.content)
    await saveMemory(userId, memory.content, memory.entityName, embedding)
  }

  // 4. Get recent messages to build relevant context
  const supabase = await createClient()
  const { data: recentMessages } = await supabase
    .from('conversation_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(3)

  const messages = (recentMessages ?? []).reverse().map(m => ({
    role: m.role as string,
    content: m.content as string,
  }))

  // 5. Build the context package
  const context = await buildContextPackage(userId, messages)

  // 6. Write to Upstash (fast path) and Supabase (persistence)
  await Promise.all([
    setCachedContext(userId, context),
    saveSentinelContext(userId, context),
  ])
}
```

- [ ] **Step 2: Create the sentinel API route**

```typescript
// apps/web/src/app/api/sentinel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runSentinel } from '@/lib/memory/sentinel'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { role, content } = body as { role: 'user' | 'assistant'; content: string }

  if (!role || !content) {
    return NextResponse.json({ error: 'Missing role or content' }, { status: 400 })
  }

  // Run sentinel — don't await, caller fires and forgets
  runSentinel(user.id, role, content).catch(err =>
    console.error('[sentinel] error:', err)
  )

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Verify types compile**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/memory/sentinel.ts apps/web/src/app/api/sentinel/route.ts
git commit -m "feat: sentinel orchestrator and API route"
```

---

## Task 9: Update Chat API Route

**Files:**
- Modify: `apps/web/src/app/api/chat/route.ts`

This task updates the chat route to: (1) fire the sentinel on user message, (2) read the context package from Upstash with Supabase fallback, (3) inject it into the Claude call, (4) fire the sentinel on Claude's response.

- [ ] **Step 1: Add context loading helper**

Add this to the TOP of `apps/web/src/app/api/chat/route.ts`, with the other imports:

```typescript
import { getCachedContext } from '@/lib/memory/cache'
import { loadSentinelContext } from '@/lib/memory/store'

async function getContextPackage(userId: string): Promise<string> {
  const cached = await getCachedContext(userId)
  if (cached) return cached
  // Fallback to Supabase on cache miss (e.g. after restart)
  return (await loadSentinelContext(userId)) ?? ''
}
```

- [ ] **Step 2: Fire sentinel on user message and inject context**

Find where the chat route saves the user message and calls Claude. Wrap it so sentinel fires first (no await) and context is read before the Claude call. The exact implementation depends on the existing route structure, but the pattern is:

```typescript
// After saving user message to conversation_messages:

// Fire sentinel for user message (no await — fire and forget)
fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sentinel`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Forward auth cookie by including credentials
    cookie: request.headers.get('cookie') ?? '',
  },
  body: JSON.stringify({ role: 'user', content: userMessage }),
}).catch(() => {}) // intentional fire-and-forget

// Read sentinel context package (Upstash, ~1ms)
const sentinelContext = await getContextPackage(userId)

// Build the last 3 messages for raw recency
const { data: recentMessages } = await supabase
  .from('conversation_messages')
  .select('role, content')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(3)

const last3 = (recentMessages ?? []).reverse()

// Prepend sentinel context to the system prompt
const systemPrompt = sentinelContext
  ? `${sentinelContext}\n\n---\n\n${existingSystemPrompt}`
  : existingSystemPrompt
```

- [ ] **Step 3: Fire sentinel on Claude response**

After streaming the full assistant response and saving it to `conversation_messages`:

```typescript
// Fire sentinel for assistant response (no await — fire and forget)
fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sentinel`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    cookie: request.headers.get('cookie') ?? '',
  },
  body: JSON.stringify({ role: 'assistant', content: assistantResponseText }),
}).catch(() => {})
```

Note: `extract.ts` skips assistant messages (returns empty arrays), so this call has near-zero cost. It exists so the sentinel can rebuild the context package after seeing Claude's full response.

- [ ] **Step 4: Verify the app still works**

```bash
npm run dev
```

Open the app, send a message, verify you get a response. Check the terminal for any `[sentinel] error:` lines.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/chat/route.ts
git commit -m "feat: inject sentinel context into Claude calls, fire sentinel async"
```

---

## Task 10: Claude Tools — save_memory and upsert_entity

**Files:**
- Create: `apps/web/src/lib/chat/tools/handlers/save_memory.ts`
- Create: `apps/web/src/lib/chat/tools/handlers/upsert_entity.ts`
- Modify: `apps/web/src/lib/chat/tools/registry.ts`

These tools let Claude proactively save something it considers important — in addition to the automatic sentinel extraction.

- [ ] **Step 1: Create the save_memory handler**

```typescript
// apps/web/src/lib/chat/tools/handlers/save_memory.ts
import { embed } from '@/lib/memory/embed'
import { saveMemory } from '@/lib/memory/store'

export async function handleSaveMemory(
  userId: string,
  input: { content: string; entity_name?: string }
): Promise<string> {
  const embedding = await embed(input.content)
  await saveMemory(userId, input.content, input.entity_name ?? null, embedding)
  return `Saved: "${input.content}"`
}
```

- [ ] **Step 2: Create the upsert_entity handler**

```typescript
// apps/web/src/lib/chat/tools/handlers/upsert_entity.ts
import { upsertEntityProfile } from '@/lib/memory/store'
import type { EntityType } from '@personal-assistant/types'

export async function handleUpsertEntity(
  userId: string,
  input: { name: string; entity_type: EntityType; description: string }
): Promise<string> {
  await upsertEntityProfile(userId, {
    name: input.name,
    entityType: input.entity_type,
    description: input.description,
  })
  return `Saved entity: ${input.name} (${input.entity_type})`
}
```

- [ ] **Step 3: Register the tools**

Open `apps/web/src/lib/chat/tools/registry.ts` and add to the tools array:

```typescript
{
  name: 'save_memory',
  description: 'Save a durable fact you have learned about the user that should be remembered across conversations.',
  input_schema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The fact to remember, written as a statement (e.g. "Roy prefers Coke over Pepsi")',
      },
      entity_name: {
        type: 'string',
        description: 'Optional: the name of the entity this fact is about (e.g. "Sarah")',
      },
    },
    required: ['content'],
  },
},
{
  name: 'upsert_entity',
  description: 'Save or update an entity profile (person, place, project, or thing) you have learned about.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The entity name (e.g. "Sarah")' },
      entity_type: {
        type: 'string',
        enum: ['person', 'place', 'project', 'thing'],
        description: 'The type of entity',
      },
      description: {
        type: 'string',
        description: 'A one-sentence description (e.g. "Roy\'s sister, lives in Denver, mentioned January 2026")',
      },
    },
    required: ['name', 'entity_type', 'description'],
  },
},
```

- [ ] **Step 4: Wire handlers in the tool dispatch**

Find where tool calls are dispatched in the chat engine and add:

```typescript
case 'save_memory':
  return handleSaveMemory(userId, toolInput as { content: string; entity_name?: string })
case 'upsert_entity':
  return handleUpsertEntity(userId, toolInput as { name: string; entity_type: EntityType; description: string })
```

- [ ] **Step 5: Verify types compile**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/chat/tools/
git commit -m "feat: save_memory and upsert_entity tools for Claude"
```

---

## Task 11: Memory Management Page

**Files:**
- Create: `apps/web/src/app/(app)/memory/page.tsx`
- Create: `apps/web/src/app/actions/memory.ts`

- [ ] **Step 1: Create the server actions**

```typescript
// apps/web/src/app/actions/memory.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { getAllEntityProfiles, getAllMemories, deleteEntityProfile, deleteMemory } from '@/lib/memory/store'
import { revalidatePath } from 'next/cache'

export async function getMemoryPageData() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const [entities, memories] = await Promise.all([
    getAllEntityProfiles(user.id),
    getAllMemories(user.id),
  ])
  return { entities, memories }
}

export async function deleteEntityAction(entityId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  await deleteEntityProfile(user.id, entityId)
  revalidatePath('/memory')
}

export async function deleteMemoryAction(memoryId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  await deleteMemory(user.id, memoryId)
  revalidatePath('/memory')
}
```

- [ ] **Step 2: Create the memory page**

```typescript
// apps/web/src/app/(app)/memory/page.tsx
import { getMemoryPageData, deleteEntityAction, deleteMemoryAction } from '@/app/actions/memory'

export default async function MemoryPage() {
  const { entities, memories } = await getMemoryPageData()

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Memory</h1>
        <p className="text-sm text-gray-500">
          Everything your assistant knows about you. Delete anything that's wrong or outdated.
        </p>
      </div>

      {/* Entities */}
      <section>
        <h2 className="text-lg font-medium mb-3">People, places & projects</h2>
        {entities.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing stored yet. Mention people or projects in chat.</p>
        ) : (
          <ul className="space-y-2">
            {entities.map(entity => (
              <li key={entity.id} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <span className="font-medium text-sm">{entity.name}</span>
                  <span className="ml-2 text-xs text-gray-400 capitalize">{entity.entityType}</span>
                  <p className="text-sm text-gray-600 mt-0.5">{entity.description}</p>
                </div>
                <form action={deleteEntityAction.bind(null, entity.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700 shrink-0 mt-0.5"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Memories */}
      <section>
        <h2 className="text-lg font-medium mb-3">Facts & preferences</h2>
        {memories.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing stored yet. Facts you share in chat will appear here.</p>
        ) : (
          <ul className="space-y-2">
            {memories.map(memory => (
              <li key={memory.id} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <p className="text-sm text-gray-700">{memory.content}</p>
                <form action={deleteMemoryAction.bind(null, memory.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700 shrink-0"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Add Memory link to app navigation**

Find the app nav component (likely in `apps/web/src/components/` or the app layout) and add a link to `/memory`.

- [ ] **Step 4: Smoke test the page**

```bash
npm run dev
```

Navigate to `/memory`. Verify it loads without errors. Send a message mentioning a person ("my sister Sarah lives in Denver"), wait a few seconds, refresh `/memory` — Sarah should appear under entities.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/memory/ apps/web/src/app/actions/memory.ts
git commit -m "feat: memory management page — entities and memories with delete"
```

---

## Acceptance Criteria

Run through these manually after all tasks complete:

- [ ] **Sarah/Denver case:** Say "my sister Sarah lives in Denver" in one session. Open a new chat session. Say "I'm going to visit my sister." The assistant mentions Denver and offers to look at flights.
- [ ] **Coke/Pepsi case:** Say "I prefer Coke over Pepsi." End the session. Start a new one. Say "I need to order a drink." The assistant knows you want Coke.
- [ ] **Supersession:** Say "Sarah moved to Austin." Navigate to `/memory` — the Denver fact should be gone (superseded), Austin should appear.
- [ ] **Memory page:** `/memory` shows all stored entities and memories. Deleting one removes it from the next conversation.
- [ ] **Restart resilience:** Stop and restart the dev server. The next chat still has the context (loaded from Supabase into Upstash on first read).
- [ ] **Cold start:** A brand new user with no prior conversations gets a normal conversation with no injected context — no errors.

---

## Environment Variable Checklist

Before deploying to Vercel, ensure these are set in the Vercel dashboard:

- [ ] `UPSTASH_REDIS_REST_URL`
- [ ] `UPSTASH_REDIS_REST_TOKEN`
- [ ] `OPENAI_API_KEY`
- [ ] `ANTHROPIC_API_KEY` (already set in Phase 1)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` (already set)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already set)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (already set)
- [ ] `NEXT_PUBLIC_APP_URL` (needed for sentinel fetch — set to your Vercel URL)
