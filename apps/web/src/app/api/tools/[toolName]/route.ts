import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import { ALL_TOOL_NAMES } from '@/lib/chat/tools/registry'
import type { ToolName } from '@personal-assistant/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ toolName: string }> },
) {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { toolName } = await params
  if (!ALL_TOOL_NAMES.includes(toolName as ToolName)) {
    return NextResponse.json({ error: 'Unknown tool' }, { status: 404 })
  }

  const { enabled } = await request.json()
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from('tool_permissions')
    .upsert(
      { user_id: user.id, tool_name: toolName, enabled },
      { onConflict: 'user_id,tool_name' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tool_name: toolName, enabled })
}
