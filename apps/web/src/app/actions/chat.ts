'use server'

import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import type { ChatMessage } from '@/components/chat/types'

export async function getChatHistory(conversationId: string): Promise<ChatMessage[]> {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const db = createServiceClient()
  const { data } = await db
    .from('conversation_messages')
    .select('id, role, content, created_at')
    .eq('user_id', user.id)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (!data) return []

  return data.map(row => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: [{ type: 'text' as const, text: row.content }],
    created_at: row.created_at,
  }))
}
