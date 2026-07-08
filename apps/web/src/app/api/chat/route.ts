import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import { runChatEngine, type SSEEvent } from '@/lib/chat/engine'
import { ALL_TOOL_NAMES } from '@/lib/chat/tools/registry'
import type { ChatMessage } from '@/components/chat/types'

async function seedToolPermissions(userId: string): Promise<void> {
  const db = createServiceClient()
  await db.from('tool_permissions').upsert(
    ALL_TOOL_NAMES.map(name => ({ user_id: userId, tool_name: name, enabled: true })),
    { onConflict: 'user_id,tool_name', ignoreDuplicates: true },
  )
}

export async function POST(request: Request) {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let messages: ChatMessage[]
  let conversationId: string
  try {
    const body = await request.json()
    messages = body.messages
    conversationId = body.conversationId
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 })
    }
    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  await seedToolPermissions(user.id)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: SSEEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        await runChatEngine({ userId: user.id, conversationId, clientMessages: messages, send })
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
