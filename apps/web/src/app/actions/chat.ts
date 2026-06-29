'use server'

import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import type { ChatMessage, ContentBlock, ToolUseBlock, ToolResultBlock } from '@/components/chat/types'

/**
 * Shape of a single tool_call entry as stored in the `tool_calls` JSONB column.
 * The engine persists Anthropic.ToolUseBlock objects (id, name, input) into this
 * column; tool results are stored on the same assistant row alongside the tool use.
 *
 * The DB column is an array of objects with at minimum { id, name, input } matching
 * the Anthropic SDK ToolUseBlock shape. Tool result blocks are reconstructed by the
 * chat engine and are NOT stored separately — they arrive via SSE and are held in
 * client state only. We therefore re-emit only ToolUseBlock entries from history.
 */
type StoredToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  // Optionally, a paired tool result may be stored inline for history fidelity.
  tool_result?: {
    content: string
    is_error?: boolean
  }
}

/**
 * Reconstruct a ChatMessage content array from a DB row.
 *
 * Mapping strategy (tool_calls JSONB → ContentBlock[]):
 *   - `content` column  → TextBlock (always present, may be empty string)
 *   - `tool_calls` JSONB → array of ToolUseBlock + optional ToolResultBlock entries
 *     The engine stores Anthropic ToolUseBlock objects; if a `tool_result` sub-object
 *     is present on the stored entry it is emitted as a ToolResultBlock.
 */
function buildContentBlocks(
  content: string,
  toolCalls: unknown,
): ContentBlock[] {
  const blocks: ContentBlock[] = []

  // Tool-use blocks come before the text confirmation in Anthropic's turn structure.
  if (Array.isArray(toolCalls)) {
    for (const raw of toolCalls as StoredToolCall[]) {
      if (typeof raw?.id === 'string' && typeof raw?.name === 'string') {
        const toolUse: ToolUseBlock = {
          type: 'tool_use',
          id: raw.id,
          name: raw.name,
          input: raw.input ?? {},
        }
        blocks.push(toolUse)

        if (raw.tool_result) {
          const toolResult: ToolResultBlock = {
            type: 'tool_result',
            tool_use_id: raw.id,
            content: raw.tool_result.content,
            is_error: raw.tool_result.is_error,
          }
          blocks.push(toolResult)
        }
      }
    }
  }

  // Always append the text block last (matches live-stream order).
  if (content) {
    blocks.push({ type: 'text', text: content })
  }

  // If there are no blocks at all, return an empty-text block to keep the type valid.
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' })
  }

  return blocks
}

/**
 * Fetch up to 200 messages for a conversation, ordered oldest-first.
 * Returns [] (never throws) for unauthenticated callers or on any DB error.
 * Limit of 200 is intentional — prevents unbounded fetches in Phase 1.
 */
export async function getChatHistory(conversationId: string): Promise<ChatMessage[]> {
  try {
    const supabase = await createAuthServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const db = createServiceClient()
    const { data } = await db
      .from('conversation_messages')
      .select('id, role, content, tool_calls, created_at')
      .eq('user_id', user.id)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (!data) return []

    return data.map(row => ({
      id: row.id as string,
      role: row.role as 'user' | 'assistant',
      content: buildContentBlocks(
        (row.content as string) ?? '',
        row.tool_calls,
      ),
      created_at: row.created_at as string,
    }))
  } catch {
    return []
  }
}
